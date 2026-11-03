#!/usr/bin/env python3
"""Ephemeral distribution signing support; never print credentials or command args.

The API key authenticates readonly profile download, not code signing. Archive
uses an imported Distribution identity and app-target settings written by the
Fastlane lane. This module is also importable for synthetic profile tests without
Xcode, Keychain Services, network access, or a redirected HOME.
"""

import base64
import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import re
import secrets
import shlex
import shutil
import subprocess
import sys


class SigningError(Exception):
    """A safe, deliberately value-free error suitable for a public CI log."""


def run(args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        # CalledProcessError includes the full argv (including keychain passwords).
        raise SigningError(f"{args[0]} operation failed (exit {result.returncode})")
    return result.stdout


def validate_profile(profile, team, bundle, name):
    entitlements = profile.get("Entitlements", {})
    expiry = profile.get("ExpirationDate")
    valid = (
        profile.get("Name") == name
        and profile.get("TeamIdentifier") == [team]
        and entitlements.get("application-identifier") == f"{team}.{bundle}"
        and entitlements.get("com.apple.developer.team-identifier") == team
        and entitlements.get("aps-environment") == "production"
        and entitlements.get("get-task-allow") is False
        and "ProvisionedDevices" not in profile
        and not profile.get("ProvisionsAllDevices", False)
        and isinstance(expiry, datetime.datetime)
        and expiry.replace(tzinfo=datetime.timezone.utc)
        > datetime.datetime.now(datetime.timezone.utc)
        and re.fullmatch(r"[A-Fa-f0-9-]{36}", profile.get("UUID", ""))
    )
    if not valid:
        raise SigningError("App Store profile identity, capability or validity check failed")


def validate_entitlements(entitlements, team, bundle):
    if (
        entitlements.get("application-identifier") != f"{team}.{bundle}"
        or entitlements.get("com.apple.developer.team-identifier") != team
        or entitlements.get("aps-environment") != "production"
        or entitlements.get("get-task-allow") is not False
    ):
        raise SigningError("IPA distribution entitlement check failed")


def export_options(team, bundle, profile_name):
    return {
        "method": "app-store-connect",
        "teamID": team,
        "signingStyle": "manual",
        "signingCertificate": "Apple Distribution",
        "provisioningProfiles": {bundle: profile_name},
        "destination": "export",
        "manageAppVersionAndBuildNumber": False,
        "uploadSymbols": True,
    }


def prepare(directory):
    state = {
        "search": shlex.split(run(["security", "list-keychains", "-d", "user"]).decode()),
        "default": shlex.split(run(["security", "default-keychain", "-d", "user"]).decode()),
        "profiles": [],
    }
    (directory / "state.json").write_text(json.dumps(state))
    keychain = str(directory / "distribution.keychain-db")
    password = secrets.token_urlsafe(32)
    run(["security", "create-keychain", "-p", password, keychain])
    run(["security", "set-keychain-settings", "-lut", "21600", keychain])
    run(["security", "unlock-keychain", "-p", password, keychain])
    run(["security", "list-keychains", "-d", "user", "-s", keychain, *state["search"]])
    run(["security", "default-keychain", "-d", "user", "-s", keychain])
    for variable, filename in [
        ("APPLE_DIST_CERT_P12_BASE64", "distribution.p12"),
        ("APPLE_ASC_PRIVATE_KEY_BASE64", "asc-api-key.p8"),
    ]:
        try:
            (directory / filename).write_bytes(base64.b64decode("".join(os.environ[variable].split()), validate=True))
        except (ValueError, KeyError):
            raise SigningError("Signing credential decoding failed") from None
    run([
        "security", "import", str(directory / "distribution.p12"), "-k", keychain,
        "-P", os.environ["APPLE_DIST_CERT_PASSWORD"], "-T", "/usr/bin/codesign",
        "-T", "/usr/bin/security",
    ])
    run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
         "-s", "-k", password, keychain])
    identities = run(["security", "find-identity", "-v", "-p", "codesigning", keychain]).decode()
    fingerprints = re.findall(r'([A-Fa-f0-9]{40}) "Apple Distribution[^"\n]*"', identities)
    if not fingerprints:
        raise SigningError("No valid Apple Distribution identity with private key")
    (directory / "identities.json").write_text(json.dumps([s.upper() for s in fingerprints]))
    print("Imported valid Distribution signing identity into ephemeral keychain")


def profile(directory):
    team = os.environ["APPLE_TEAM_ID"]
    bundle = (directory / "bundle-id.txt").read_text().strip()
    name = os.environ["LO_IOS_PROFILE_NAME"]
    data = run(["security", "cms", "-D", "-i", str(directory / "distribution.mobileprovision")])
    parsed = plistlib.loads(data)
    validate_profile(parsed, team, bundle, name)
    certs = {hashlib.sha1(c).hexdigest().upper() for c in parsed.get("DeveloperCertificates", [])}
    if not certs.intersection(json.loads((directory / "identities.json").read_text())):
        raise SigningError("Profile does not authorize the imported Distribution identity")
    state = json.loads((directory / "state.json").read_text())
    # Xcode 16+ moved this directory; install only our validated UUID in both
    # locations for runner compatibility, without overwriting an existing asset.
    for base in ["Library/Developer/Xcode/UserData/Provisioning Profiles",
                 "Library/MobileDevice/Provisioning Profiles"]:
        dest = pathlib.Path.home() / base / (parsed["UUID"] + ".mobileprovision")
        if dest.exists():
            raise SigningError("Refusing to overwrite an existing provisioning profile")
        dest.parent.mkdir(parents=True, exist_ok=True)
        state["profiles"].append(str(dest))
        (directory / "state.json").write_text(json.dumps(state))
        shutil.copyfile(directory / "distribution.mobileprovision", dest)
    (directory / "profile-uuid.txt").write_text(parsed["UUID"])
    (directory / "ExportOptions.plist").write_bytes(plistlib.dumps(export_options(team, bundle, name)))
    print("Verified App Store profile, production push and matching Distribution identity")


def verify(directory):
    ipas = list((pathlib.Path(os.environ["RUNNER_TEMP"]) / "ipa").glob("*.ipa"))
    if len(ipas) != 1:
        raise SigningError("Expected exactly one exported IPA")
    unpacked = directory / "verified"
    run(["ditto", "-x", "-k", str(ipas[0]), str(unpacked)])
    apps = list((unpacked / "Payload").glob("*.app"))
    if len(apps) != 1:
        raise SigningError("Expected exactly one exported application")
    app = str(apps[0])
    run(["codesign", "--verify", "--deep", "--strict", app])
    # codesign -dv writes its identity display to stderr. Capture it without
    # publishing team/account identifiers or certificate details in CI logs.
    display = subprocess.run(["codesign", "-dv", "--verbose=4", app], capture_output=True)
    if display.returncode or b"Authority=Apple Distribution" not in display.stderr:
        raise SigningError("IPA is not signed by Apple Distribution")
    team = os.environ["APPLE_TEAM_ID"]
    bundle = (directory / "bundle-id.txt").read_text().strip()
    if f"TeamIdentifier={team}".encode() not in display.stderr:
        raise SigningError("IPA codesign team check failed")
    with (apps[0] / "Info.plist").open("rb") as f:
        info = plistlib.load(f)
        if info.get("CFBundleIdentifier") != bundle:
            raise SigningError("IPA bundle check failed")
        if info.get("ITSAppUsesNonExemptEncryption") is not False:
            raise SigningError("IPA export compliance flag check failed")
    embedded = plistlib.loads(run(["security", "cms", "-D", "-i", str(apps[0] / "embedded.mobileprovision")]))
    validate_profile(embedded, team, bundle, os.environ["LO_IOS_PROFILE_NAME"])
    if embedded["UUID"] != (directory / "profile-uuid.txt").read_text():
        raise SigningError("IPA embedded profile differs from the selected profile")
    certificate_prefix = str(directory / "signing-certificate-")
    run(["codesign", "-d", "--extract-certificates", certificate_prefix, app])
    if (directory / "signing-certificate-0").read_bytes() not in embedded.get("DeveloperCertificates", []):
        raise SigningError("IPA signing certificate is not authorized by its profile")
    entitlements = plistlib.loads(run(["codesign", "-d", "--entitlements", ":-", app]))
    validate_entitlements(entitlements, team, bundle)
    print("IPA codesign verified: Distribution identity, bundle/team, production aps-environment, get-task-allow=false")


def cleanup(directory):
    if not directory.exists():
        return
    errors = []
    statefile = directory / "state.json"
    if statefile.exists():
        state = json.loads(statefile.read_text())
        # Attempt every restoration even if one security operation fails. Removing
        # credentials must not depend on success of keychain-list restoration.
        commands = [["security", "list-keychains", "-d", "user", "-s", *state["search"]]]
        if state["default"]:
            commands.append(["security", "default-keychain", "-d", "user", "-s", state["default"][0]])
        keychain = directory / "distribution.keychain-db"
        if keychain.exists():
            commands.append(["security", "delete-keychain", str(keychain)])
        for command in commands:
            try:
                run(command)
            except SigningError as error:
                errors.append(str(error))
        for filename in state["profiles"]:
            pathlib.Path(filename).unlink(missing_ok=True)
    shutil.rmtree(directory)
    if errors:
        raise SigningError("Signing material removed but keychain restoration failed")
    print("Removed ephemeral signing credentials and restored keychains")


def main():
    raw = os.environ.get("LO_IOS_SIGNING_DIR", "")
    if not raw and sys.argv[1] == "cleanup":
        return
    directory = pathlib.Path(raw)
    # Cleanup is destructive by design but may touch only the action's own mktemp
    # directory; reject empty/untrusted paths before invoking any deletion.
    root = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    if directory.parent.resolve() != root or not directory.name.startswith("lo-ios-signing."):
        raise SigningError("Invalid ephemeral signing directory")
    {"prepare": prepare, "profile": profile, "verify": verify, "cleanup": cleanup}[sys.argv[1]](directory)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never stringify unexpected exceptions: decoded payloads or subprocess
        # argv can contain credential values. The failed CI step names the phase.
        print("::error::iOS signing phase failed; credentials and command arguments withheld", file=sys.stderr)
        sys.exit(1)

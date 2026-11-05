import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The diagnostic path now starts 39 tiny Node tools: measured 32.4s alone,
 * while the same path exceeded 45s under Vitest fleet load. This is a bounded
 * Node-ONLY test budget: it never extends a native cap, because the media
 * caps that used to exist here were deleted with the PhotoKit ingest path. */
export const STAGE_B_NODE_PROBE_MS = 90_000;

/** A tiny synthetic checkout and executable shims, not a second native harness.
 * No SDK, simulator, git network or installation can be reached: PATH contains
 * ONLY these regular Node scripts. Even plutil is redirected by the test API. */
export function probeStageBCoordinator(
	oldRedactedReturn = false,
	unsignedBuild = false,
	seedFails = false,
	setup?: { bootFails?: boolean; deleteFails?: boolean },
): Record<string, unknown> {
	const repository = fileURLToPath(new URL("../../", import.meta.url));
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"stage-b-node-probe-",
		),
	);
	// A regular file where the device directory should be: mkdir fails closed.
	const seedBlocker = join(root, "seed-blocker");
	writeFileSync(seedBlocker, "not a directory\n");
	// The fake device needs a real Files location, or the seeding prerequisite
	// fails for the wrong reason: CloudDocs is preferred where it exists.
	const fakeDevice = join(
		root,
		"simulators",
		"00000000-0000-4000-8000-000000000001",
		"data",
		"Library/Mobile Documents/com~apple~CloudDocs",
	);
	mkdirSync(fakeDevice, { recursive: true });
	const tools = join(root, "tools");
	mkdirSync(tools);
	mkdirSync(join(root, "tmp"));
	mkdirSync(join(root, "home"));
	mkdirSync(join(root, ".github/workflows"), { recursive: true });
	const sha = "a".repeat(40);
	const workflow = `name: Node-only probe\n# identity ${sha}; nonce ${"b".repeat(32)}\n`;
	writeFileSync(
		join(root, ".github/workflows/stage-b-draft-proof.yml"),
		workflow,
	);
	writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
	writeFileSync(
		join(root, "package.json"),
		'{"name":"node-only-proof","main":"ordinary-entry"}',
	);
	writeFileSync(
		join(root, "app.config.ts"),
		'export default {name:"Node-only proof",slug:"node-only-proof"};',
	);
	mkdirSync(join(root, "src/features/auth"), { recursive: true });
	writeFileSync(
		join(root, "src/features/auth/computers.tsx"),
		readFileSync(join(repository, "src/features/auth/computers.tsx"), "utf8"),
	);
	writeFileSync(
		join(root, "src/features/auth/connection-provider.tsx"),
		readFileSync(
			join(repository, "src/features/auth/connection-provider.tsx"),
			"utf8",
		),
	);
	const shim = `#!${process.execPath}
// Stage B Node-only fake native tool
const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),args=process.argv.slice(2),root=process.cwd();
const out=value=>process.stdout.write(String(value)+'\\n');
const config=()=>JSON.parse(fs.readFileSync(path.join(root,'stage-b-proof-entry.js'),'utf8').match(/installStageBDraftProof\\((\\{[^\\n]+\\})\\)/)[1]);
const installed=path.join(root,'Library/Developer/CoreSimulator/Devices/00000000-0000-4000-8000-000000000001/data/Containers/Bundle/Application/00000000-0000-4000-8000-000000000002/StageBDraftProof.app');
if(name==='git'){if(args[0]==='rev-parse')out(process.env.STAGE_B_SOURCE_SHA);else if(args[0]==='show')out(fs.readFileSync(path.join(root,'.github/workflows/stage-b-draft-proof.yml'),'utf8').trim());}
else if(name==='df')out('Filesystem 1024-blocks Used Available Capacity Mounted on\\nnode-only 99999999 0 99999999 0% /');
else if(name==='pod')out('1.16.2');
else if(name==='pnpm'){if(args.includes('prebuild')){fs.mkdirSync(path.join(root,'ios/StageBDraftProof.xcworkspace'),{recursive:true});fs.mkdirSync(path.join(root,'ios/StageBDraftProof.xcodeproj'),{recursive:true});}else out('57.0.26');}
else if(name==='xcodebuild'){if(args.includes('-version'))out('Xcode 26.0');else{for(const flag of ['CODE_SIGN_IDENTITY=-','CODE_SIGN_STYLE=Manual','DEVELOPMENT_TEAM=','CODE_SIGNING_ALLOWED=YES','CODE_SIGNING_REQUIRED=NO'])if(!args.includes(flag))throw Error('ADHOC_ARGS_REQUIRED:'+flag);const ent=args.find(a=>a.startsWith('CODE_SIGN_ENTITLEMENTS='));if(!ent||!fs.readFileSync(ent.slice('CODE_SIGN_ENTITLEMENTS='.length),'utf8').includes('<dict/>'))throw Error('EMPTY_SIMULATOR_ENTITLEMENTS_REQUIRED');const c=config(),derived=args[args.indexOf('-derivedDataPath')+1],app=path.join(derived,'Build/Products/Release-iphonesimulator/StageBDraftProof.app');fs.mkdirSync(app,{recursive:true});fs.writeFileSync(path.join(app,'Info.plist'),JSON.stringify({CFBundleIdentifier:c.bundleId,CFBundleExecutable:'StageBDraftProof',StageBProofSourceSha:c.sourceSha,StageBProofNonce:c.nonce,StageBProofFlavor:c.flavor}));fs.writeFileSync(path.join(app,'main.jsbundle'),JSON.stringify(c));fs.writeFileSync(path.join(app,'StageBDraftProof'),'NODE ONLY executable placeholder');}}
else if(name==='codesign'){if(args.includes('-dv'))out('Executable='+args.at(-1)+'\\nSignature=adhoc\\nTeamIdentifier=not set');else if(args.includes('--entitlements'))out('<plist version="1.0"><dict/></plist>');else throw Error('UNEXPECTED_CODESIGN_OPERATION');}
else if(name==='plutil'){const info=JSON.parse(fs.readFileSync(args.at(-1),'utf8'));out(info[args[1]]);}
else if(name==='xcrun'){const op=args[1];if(op==='list')out(JSON.stringify({runtimes:[{identifier:'com.apple.CoreSimulator.SimRuntime.iOS-26-0',name:'iOS 26.0',isAvailable:true}]}));else if(op==='create')out('00000000-0000-4000-8000-000000000001');else if(op==='bootstatus'&&${setup?.bootFails ?? false}){out('Waiting on System App; isTerminal=NO');process.exitCode=19;}else if(op==='delete'&&${setup?.deleteFails ?? false}){process.exitCode=20;}else if(op==='install'){fs.mkdirSync(path.dirname(installed),{recursive:true});fs.cpSync(args[3],installed,{recursive:true});}else if(op==='get_app_container')out(installed);else if(op==='launch')out('com.localoperator.mobile.stagebproof: 12345');else if(op==='io')fs.writeFileSync(args.at(-1),'NODE ONLY screenshot placeholder');else if(op==='spawn')out('NODE ONLY os_log capture');}
else if(name==='maestro'){if(args.includes('--version'))out('2.11.0');else if(args.includes('hierarchy'))out(JSON.stringify({identifier:'home-screen'}));else if(args.includes('test')){out('NODE_ONLY_FAKE_FLOW_STOP');process.exitCode=17;}}
else throw Error('Unexpected tool '+name);
`;
	for (const name of [
		"git",
		"df",
		"pod",
		"pnpm",
		"xcodebuild",
		"plutil",
		"codesign",
		"xcrun",
		"maestro",
	])
		writeFileSync(join(tools, name), shim, { mode: 0o755 });
	let proofModule = pathToFileURL(
		join(repository, "scripts/ci/stage-b-draft-proof.ts"),
	).href;
	if (oldRedactedReturn || unsignedBuild) {
		// Counterfactual copy only: never modify the owned implementation/worktree.
		let source = readFileSync(fileURLToPath(proofModule), "utf8");
		if (!source.includes("done(bytes.trim())"))
			throw Error("raw return mutation site missing");
		if (oldRedactedReturn)
			source = source.replace("done(bytes.trim())", "done(safe.trim())");
		if (unsignedBuild)
			source = source.replace(
				'"CODE_SIGNING_ALLOWED=YES"',
				'"CODE_SIGNING_ALLOWED=NO"',
			);
		source = source.replace(
			/from (["'])(\.[^"']+)\1/g,
			(_match, quote, specifier) =>
				`from ${quote}${pathToFileURL(resolve(repository, "scripts/ci", specifier)).href}${quote}`,
		);
		const control = join(root, "old-redacted-return.mts");
		writeFileSync(control, source);
		proofModule = pathToFileURL(control).href;
	}
	const runner = `import{readFileSync,readdirSync,writeFileSync}from'node:fs';import{join}from'node:path';import{createHash}from'node:crypto';import{runStageBNodeDryRun}from ${JSON.stringify(proofModule)};
const raw=new Map();let error='';try{await runStageBNodeDryRun(process.env,${JSON.stringify(tools)},(name,value)=>raw.set(name,value));}catch(e){error=String(e.message);}
const output=join(process.env.RUNNER_TEMP,'stage-b-draft-proof-'+process.env.STAGE_B_SOURCE_SHA.slice(0,12));const receipt=JSON.parse(readFileSync(join(output,'receipt.json'),'utf8'));const logs=readdirSync(join(output,'commands'));const log=name=>readFileSync(join(output,'commands',logs.find(p=>p.endsWith('-'+name+'.log'))),'utf8');
const entry=readFileSync('stage-b-proof-entry.js','utf8');const cfg=JSON.parse(entry.match(/installStageBDraftProof\\((\\{[^\\n]+\\})\\)/)[1]);
const result={nodeOnly:true,sourceRaw:raw.get('source')===process.env.STAGE_B_SOURCE_SHA,workflowRaw:raw.get('evaluated-workflow')===readFileSync('.github/workflows/stage-b-draft-proof.yml','utf8').trim(),nonceRaw:raw.get('plist-StageBProofNonce')===cfg.nonce,containerRaw:raw.get('installed-container')?.includes('/Library/Developer/CoreSimulator/')&&raw.get('installed-container')?.endsWith('/StageBDraftProof.app'),signature:receipt.installedSignature,entitlementsLogged:receipt.commands.some(c=>c.name==='installed-signing-entitlements'),pids:receipt.launchPids,stoppedAtFakeFlow:error.includes('warm-app-foreground failed: rc=17'),error,logsRedacted:{sha:!log('source').includes(process.env.STAGE_B_SOURCE_SHA),nonce:raw.has('plist-StageBProofNonce')?!log('plist-StageBProofNonce').includes(cfg.nonce):null,path:raw.has('installed-container')?!log('installed-container').includes(raw.get('installed-container')):null},argsRedacted:receipt.commands.every(c=>c.args.every(arg=>!arg.includes(cfg.nonce)&&!arg.includes(cfg.sourceSha)&&!arg.includes(process.env.GITHUB_WORKFLOW_SHA))),safeDigests:receipt.commands.every((c,i)=>c.outputDigest===createHash('sha256').update(readFileSync(join(output,'commands',logs.find(p=>p.startsWith(String(i+1).padStart(3,'0')+'-'))))).digest('hex')),captures:receipt.failureDiagnostics,commands:receipt.commands.map(c=>c.name)};writeFileSync(${JSON.stringify(join(root, "result.json"))},JSON.stringify(result));`;
	// The negative control stops before prepare generates the entry: use a smaller
	// reporter that still records its exact pre-simulator rejection.
	const negativeRunner = `import{readFileSync,readdirSync,writeFileSync}from'node:fs';import{join}from'node:path';import{runStageBNodeDryRun}from ${JSON.stringify(proofModule)};let error='';try{await runStageBNodeDryRun(process.env,${JSON.stringify(tools)},()=>{});}catch(e){error=String(e.message);}const receipt=JSON.parse(readFileSync(join(process.env.RUNNER_TEMP,'stage-b-draft-proof-'+process.env.STAGE_B_SOURCE_SHA.slice(0,12),'receipt.json'),'utf8'));writeFileSync(${JSON.stringify(join(root, "result.json"))},JSON.stringify({nodeOnly:true,oldRedactedReturn:${oldRedactedReturn},unsignedBuild:${unsignedBuild},rejectedUnsignedBuild:error.includes('unsigned-candidate-producer failed')&&readdirSync(join(process.env.RUNNER_TEMP,'stage-b-draft-proof-'+process.env.STAGE_B_SOURCE_SHA.slice(0,12),'commands')).filter(p=>p.endsWith('-unsigned-candidate-producer.log')).some(p=>readFileSync(join(process.env.RUNNER_TEMP,'stage-b-draft-proof-'+process.env.STAGE_B_SOURCE_SHA.slice(0,12),'commands',p),'utf8').includes('ADHOC_ARGS_REQUIRED:CODE_SIGNING_ALLOWED=YES')),error,commands:receipt.commands.map(c=>c.name)}));`;
	const setupRunner = `import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{runStageBNodeDryRun,assertStageBFullEvidence}from ${JSON.stringify(proofModule)};let error='';try{await runStageBNodeDryRun(process.env,${JSON.stringify(tools)},()=>{});}catch(e){error=String(e.message);}const receipt=JSON.parse(readFileSync(join(process.env.RUNNER_TEMP,'stage-b-setup-only-'+process.env.STAGE_B_SOURCE_SHA.slice(0,12),'receipt.json'),'utf8'));let fullEvidenceRejected=false;try{assertStageBFullEvidence(receipt);}catch{fullEvidenceRejected=true;}writeFileSync(${JSON.stringify(join(root, "result.json"))},JSON.stringify({...receipt,error,nodeOnly:true,fullEvidenceRejected,commandReceipts:receipt.commands,commands:receipt.commands.map(c=>c.name)}));`;
	const entry = join(root, "runner.mts");
	writeFileSync(
		entry,
		setup
			? setupRunner
			: oldRedactedReturn || unsignedBuild
				? negativeRunner
				: runner,
	);
	try {
		execFileSync(
			process.execPath,
			["--import", import.meta.resolve("tsx"), entry],
			{
				cwd: root,
				timeout: STAGE_B_NODE_PROBE_MS,
				stdio: "pipe",
				env: {
					PATH: tools,
					HOME: join(root, "home"),
					TMPDIR: join(root, "tmp"),
					TSX_DISABLE_CACHE: "1",
					NODE_ENV: "test",
					CI: "true",
					GITHUB_ACTIONS: "true",
					GITHUB_REPOSITORY: "damianvtran/local-operator-mobile",
					GITHUB_EVENT_NAME: "pull_request",
					GITHUB_ACTOR: "damianvtran",
					STAGE_B_PROOF_MODE: setup ? "setup-only" : "full",
					STAGE_B_SETUP_APPROVED: setup ? "true" : "false",
					STAGE_B_SETUP_LABEL_CONFIRMED: setup ? "true" : "false",
					STAGE_B_NATIVE_APPROVED: "true",
					STAGE_B_SOURCE_SHA: sha,
					GITHUB_WORKFLOW_SHA: "c".repeat(40),
					RUNNER_TEMP: join(root, "output"),
					STAGE_B_MAESTRO: join(tools, "maestro"),
					// Seeding is host-side (no fake tool), so its failure injection is a
					// data root that cannot be created: a regular file stands in for the
					// device directory. Never the operator's real CoreSimulator tree.
					STAGE_B_SIMULATOR_DATA_ROOT: seedFails
						? join(seedBlocker, "devices")
						: join(root, "simulators"),
					GIT_CONFIG_SYSTEM: "/dev/null",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_TERMINAL_PROMPT: "0",
				},
			},
		);
		return JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	console.log(
		JSON.stringify(
			{
				candidate: probeStageBCoordinator(),
				negativeControl: probeStageBCoordinator(true),
				unsignedControl: probeStageBCoordinator(false, true),
			},
			null,
			2,
		),
	);

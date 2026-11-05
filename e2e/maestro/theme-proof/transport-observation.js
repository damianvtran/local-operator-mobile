// UI evidence only: never issue a request or print copied text/URL/error body.
var text = maestro.copiedText.trim();
var verdict =
	text.indexOf("That password was not accepted") === 0
		? "password-refused"
		: text.indexOf("That address did not answer") === 0
			? "timeout"
			: text.indexOf("That host name") === 0
				? "host"
				: text.indexOf("That tunnel's certificate") === 0
					? "tls"
					: text.indexOf("The address could not be reached") === 0 ||
							text.indexOf("Nothing answered") === 0
						? "unreachable"
						: "other";
console.log(
	"TRANSPORT_PROBE " +
		JSON.stringify({
			authority: AUTHORITY_LABEL,
			uiVerdict: verdict,
			elapsedMs: Date.now() - output.transportStarted,
		}),
);

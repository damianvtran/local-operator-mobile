## phone-access-off light ready=true
Computers
Phone access isn't turned on for your Radient account yet.
Turn it on from Local Operator on your computer.
How to turn it on
Open Radient billing

## phone-access-off-howto light ready=true
Computers
Phone access isn't turned on for your Radient account yet.
Turn it on from Local Operator on your computer.
How to turn it on
Open Radient billing
Turn on phone access
On your computer, open Local Operator → Settings → Phone access and choose Set up. You'll see the price first, before anything is turned on.

## balance-out light ready=true
Computers
Your Radient balance has run out.
Add credit and your computer reconnects by itself.
Add credit
Retry

## suspended light ready=true
Computers
Your computer will reconnect by itself — open Local Operator on it if this lasts.
Retry

## console-disabled light ready=true
Computers
Phone access for this computer is turned off in your Radient console.
Open Radient console

## provisioning light ready=true
Computers
Radient is still setting up this computer.
This usually takes under a minute.
Retry

## computer-offline light ready=true
Computers
Studio Mac is asleep or offline.
Wake it and make sure it's online.
Retry
Using a terminal?

## relay-stopped light ready=true
Computers
Local Operator isn't running on your computer.
Open it there and this reconnects by itself.
Retry
Using a terminal?

## relay-stopped-terminal light ready=true
Computers
Local Operator isn't running on your computer.
Open it there and this reconnects by itself.
Retry
Using a terminal?
ON THAT COMPUTER
Copy
lop mobile

## tunnel-gone light ready=true
Computers
Phone access is turned off on Studio Mac.
Turn it on in Local Operator → Settings → Phone access.
Refresh list
Using a terminal?

## radient-unreachable light ready=true
Computers
Radient isn't responding right now.
We'll keep trying.
Retry

## relay-wait-503-kind light ready=true
Computers
Studio Mac is still starting up.
Try again in a moment.
Retry

## setup-computer light ready=true
Computers
This app drives the sessions on your own computer, so that computer has to run a connector and stay awake. Your code stays on it.
On your computer, open Local Operator → Settings → Phone access → Set up.
Come back here when it's done — this list updates by itself.
Using a terminal?
Use an address instead
If your relay is reachable at a URL you already know, connect to it with the relay's own password. This is the route for a machine that is not on Radient at all.

## setup-computer-terminal light ready=true
Computers
This app drives the sessions on your own computer, so that computer has to run a connector and stay awake. Your code stays on it.
On your computer, open Local Operator → Settings → Phone access → Set up.
Come back here when it's done — this list updates by itself.
Using a terminal?
Create one on the computer
In a terminal on the computer you want to control:
TERMINAL
Copy
lop login radient
lop tunnel create --accept-monthly-price <amount>
lop tunnel install
`<amount>` is the price the Radient console shows for this account — `lop tunnel create` refuses anything else, and step 1 of the tunnel guide links to where it is shown.
Or in the Local Operator TUI, in two commands:
TUI
Copy
/mobile billing
/mobile enable <amount>
I've run it — connect it
Attach one that already exists
If you created the tunnel in the Radient console, attach it by the id the console shows. This command is for a tunnel that already exists — it will not create one.
Tunnel id
ATTACH
Copy
lop tunnel connect <tunnel-id>
Use an address instead
If your relay is reachable at a URL you already know, connect to it with the relay's own password. This is the route for a machine that is not on Radient at all.

## own-tunnel light ready=true
Your own tunnel
No Radient account is needed for any of this. You publish the relay on your own computer through a tunnel you control, and the app talks to it through the address you paste below.
1.
On the computer
The relay binds loopback only, so this is the machine that has to run it. Leave it awake while you use the app.
INSTALL ON THE COMPUTER
Copy
macOS: writes the supervised daemon, generates the portal password and keeps it in your keychain.
lop mobile install
OR RUN IT IN THE FOREGROUND
Copy
Any other platform, or when you would rather watch the log. It serves 127.0.0.1:4098, loopback only.
LOP_MOBILE_PASSWORD=... lop mobile serve
CHECK IT
Copy
Health, the state of the auth gate, and the sessions the phone will see.
lop mobile status
SET OR ROTATE THE PASSWORD
Copy
Asks you interactively, so the value never reaches a shell history or a process list. This is the password the app asks for below.
lop mobile password
2.
Publish it
Any tunnel works as long as it forwards a public HTTPS URL to 127.0.0.1:4098 on that computer.
CLOUDFLARE
Copy
Free and needs no account for a quick tunnel. It prints the https:// URL to paste below.
cloudflared tunnel --url http://127.0.0.1:4098
NGR

## phone-access-off dark ready=true
Computers
Phone access isn't turned on for your Radient account yet.
Turn it on from Local Operator on your computer.
How to turn it on
Open Radient billing

## phone-access-off-howto dark ready=true
Computers
Phone access isn't turned on for your Radient account yet.
Turn it on from Local Operator on your computer.
How to turn it on
Open Radient billing
Turn on phone access
On your computer, open Local Operator → Settings → Phone access and choose Set up. You'll see the price first, before anything is turned on.

## balance-out dark ready=true
Computers
Your Radient balance has run out.
Add credit and your computer reconnects by itself.
Add credit
Retry

## suspended dark ready=true
Computers
Your computer will reconnect by itself — open Local Operator on it if this lasts.
Retry

## console-disabled dark ready=true
Computers
Phone access for this computer is turned off in your Radient console.
Open Radient console

## provisioning dark ready=true
Computers
Radient is still setting up this computer.
This usually takes under a minute.
Retry

## computer-offline dark ready=true
Computers
Studio Mac is asleep or offline.
Wake it and make sure it's online.
Retry
Using a terminal?

## relay-stopped dark ready=true
Computers
Local Operator isn't running on your computer.
Open it there and this reconnects by itself.
Retry
Using a terminal?

## relay-stopped-terminal dark ready=true
Computers
Local Operator isn't running on your computer.
Open it there and this reconnects by itself.
Retry
Using a terminal?
ON THAT COMPUTER
Copy
lop mobile

## tunnel-gone dark ready=true
Computers
Phone access is turned off on Studio Mac.
Turn it on in Local Operator → Settings → Phone access.
Refresh list
Using a terminal?

## radient-unreachable dark ready=true
Computers
Radient isn't responding right now.
We'll keep trying.
Retry

## relay-wait-503-kind dark ready=true
Computers
Studio Mac is still starting up.
Try again in a moment.
Retry

## setup-computer dark ready=true
Computers
This app drives the sessions on your own computer, so that computer has to run a connector and stay awake. Your code stays on it.
On your computer, open Local Operator → Settings → Phone access → Set up.
Come back here when it's done — this list updates by itself.
Using a terminal?
Use an address instead
If your relay is reachable at a URL you already know, connect to it with the relay's own password. This is the route for a machine that is not on Radient at all.

## setup-computer-terminal dark ready=true
Computers
This app drives the sessions on your own computer, so that computer has to run a connector and stay awake. Your code stays on it.
On your computer, open Local Operator → Settings → Phone access → Set up.
Come back here when it's done — this list updates by itself.
Using a terminal?
Create one on the computer
In a terminal on the computer you want to control:
TERMINAL
Copy
lop login radient
lop tunnel create --accept-monthly-price <amount>
lop tunnel install
`<amount>` is the price the Radient console shows for this account — `lop tunnel create` refuses anything else, and step 1 of the tunnel guide links to where it is shown.
Or in the Local Operator TUI, in two commands:
TUI
Copy
/mobile billing
/mobile enable <amount>
I've run it — connect it
Attach one that already exists
If you created the tunnel in the Radient console, attach it by the id the console shows. This command is for a tunnel that already exists — it will not create one.
Tunnel id
ATTACH
Copy
lop tunnel connect <tunnel-id>
Use an address instead
If your relay is reachable at a URL you already know, connect to it with the relay's own password. This is the route for a machine that is not on Radient at all.

## own-tunnel dark ready=true
Your own tunnel
No Radient account is needed for any of this. You publish the relay on your own computer through a tunnel you control, and the app talks to it through the address you paste below.
1.
On the computer
The relay binds loopback only, so this is the machine that has to run it. Leave it awake while you use the app.
INSTALL ON THE COMPUTER
Copy
macOS: writes the supervised daemon, generates the portal password and keeps it in your keychain.
lop mobile install
OR RUN IT IN THE FOREGROUND
Copy
Any other platform, or when you would rather watch the log. It serves 127.0.0.1:4098, loopback only.
LOP_MOBILE_PASSWORD=... lop mobile serve
CHECK IT
Copy
Health, the state of the auth gate, and the sessions the phone will see.
lop mobile status
SET OR ROTATE THE PASSWORD
Copy
Asks you interactively, so the value never reaches a shell history or a process list. This is the password the app asks for below.
lop mobile password
2.
Publish it
Any tunnel works as long as it forwards a public HTTPS URL to 127.0.0.1:4098 on that computer.
CLOUDFLARE
Copy
Free and needs no account for a quick tunnel. It prints the https:// URL to paste below.
cloudflared tunnel --url http://127.0.0.1:4098
NGR

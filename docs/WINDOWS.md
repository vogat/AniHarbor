# Run AniHarbor on Windows

Use Windows for the final Samsung installation if that is where your development tools are already set up. All source files are portable; Mac development does not lock the app to a Mac. The server can also remain on a Mac while Windows is used only for signing and installation.

## Start the application

Install a supported **Node.js 22 or later** release from [Node.js](https://nodejs.org/en/download). Copy the project to a folder such as `C:\Projects\AniHarbor`, or extract `dist/AniHarbor-source.zip` there. Leave `node_modules`, private `.data`, and Samsung certificates behind. Dependencies should be installed on the destination computer.

Open PowerShell in that folder:

```powershell
node --version
npm.cmd install --ignore-scripts
npm.cmd start
```

`npm.cmd` avoids PowerShell script-execution-policy issues without changing your machine's policy. For exact dependency versions, use `pnpm install --frozen-lockfile --ignore-scripts` with the supplied `pnpm-lock.yaml` instead. The service listens on port **8787** and prints a generated pairing token. Keep the terminal running. The token is stored in `.data/pairing-token`; do not publish it or share it in screenshots.

Open [the local app](http://localhost:8787) on the computer. Configure the app with the printed token. A fresh Windows installation generates its own token, so update the TV Settings when switching server computers.

## Allow the TV to reach the server

On a trusted home network, use the **Private** Windows network profile. If Windows Firewall asks about Node.js, allow it on **Private networks only**. Do not select Public networks and do not disable the firewall.

If a narrowly scoped rule is needed, run this once in an administrator PowerShell window:

```powershell
New-NetFirewallRule -DisplayName 'AniHarbor home network' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -Profile Private -RemoteAddress LocalSubnet
```

This intentionally restricts access to your local subnet. It is unnecessary if an existing appropriate rule already allows the service. Do not set up router port forwarding or expose the service publicly.

Find the address for your active Wi-Fi or Ethernet adapter:

```powershell
ipconfig
```

If its IPv4 address is `192.168.1.25`, enter **`http://192.168.1.25:8787`** in AniHarbor on the TV. Use the same pairing token that the server prints. Reserve this PC address in your router if you want it to stay consistent after restarts. Both devices must be on the same reachable LAN; a guest Wi-Fi network may isolate devices.

## Build and install the TV app

```powershell
node scripts/build-tv.mjs
```

This creates the unsigned folder `dist/tv/`, including the application icon. It does not install anything on the TV. Follow [the Samsung installation instructions](INSTALL-TV.md) to connect your television, create your certificate profile, produce the signed `.wgt`, and install it.

## Everyday use

Start the server with `npm.cmd start`, keep the computer awake, then open AniHarbor on the TV. Your monitor can turn off, but Windows sleep stops the server. Closing the terminal also stops it. Provider updates happen on the server, while frontend changes need a new signed TV package.

If the TV cannot connect, first verify that the browser on the computer can open the app. Then verify the PC address, port, pairing token, Private firewall rule, and whether the PC is asleep. A VPN or guest network can prevent local connectivity.

The server does not make incompatible codecs playable on an older TV. A provider may return a usable link that the 2016 player cannot decode; test other available streams and sources. End-to-end TV playback remains a hardware check.

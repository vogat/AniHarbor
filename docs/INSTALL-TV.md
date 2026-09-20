# Install AniHarbor on the Samsung TV

Target: **Samsung UN60KU630DFXZA (2016), Tizen 2.4**. The TV runs the small web application; your awake computer runs the provider service. The application manifest targets 2.4. A modern emulator does not establish compatibility with this TV; playback, subtitles, remote navigation, and installation must still be checked on the actual device. [Samsung platform specifications](https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html)

## What is ready, and what needs your TV

`node scripts/build-tv.mjs` prepares `dist/tv/`. Creating an installable `.wgt` additionally needs Samsung's SDK and a certificate profile registered to your TV. There is no signed package or completed TV installation until those steps succeed.

This is a **development installation**, not an app published in the Samsung store. Samsung's testing FAQ says Studio-installed applications can be uninstalled when the TV switches off or disconnects from Studio. Expect to test persistence on your firmware and potentially reinstall; a permanent Home tile is not promised. Copying the unsigned folder to a USB stick does not replace the certificate/install workflow. [Samsung testing FAQ, Q1 and Q7](https://developer.samsung.com/smarttv/develop/faq/application-testing.html)

## 1. Prepare the computer

Windows is the recommended installation computer for this project. You can develop and run the server on either operating system; there is no need to switch computers merely to edit code. Follow [Windows setup](WINDOWS.md) to start the server and find its LAN address.

Install Tizen Studio and, through Package Manager, the **TV Extension**, **Samsung Certificate Extension**, and **Web CLI**. Use Samsung Certificate Extension **2.0.73 or newer**: Samsung states older versions cannot create certificates after September 2025. Use the current installers and their host prerequisites, rather than an old SDK copied from a tutorial. [Samsung SDK installation](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html), [TV Extension downloads](https://developer.samsung.com/smarttv/develop/tools/tv-extension/download.html), [CLI prerequisites](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)

The TV Extension download offers Windows and macOS packages. Samsung's older prerequisite page names Intel Mac hardware, so do not assume the emulator works on an Apple Silicon Mac. The physical TV is the decisive test device. [Samsung SDK prerequisites](https://developer.samsung.com/smarttv/develop/tools/prerequisites.html)

## 2. Connect the TV

1. Connect the TV and installation computer to the same home network. Note both IPv4 addresses; the PC address and TV address serve different purposes.
2. On the TV, open **Smart Hub → Apps**. Enter **12345** with the remote number pad. Depending on the firmware, open Apps settings before entering the sequence.
3. Turn Developer Mode on, enter the **computer's LAN IPv4 address**, and restart the TV. If Samsung Instant On prevents a full restart, power-cycle it.
4. In Tizen Studio, open **Tools → Device Manager → Remote Device Manager**. Add the **TV's IPv4 address**, port **26101**, then connect.
5. Verify the target is connected. Do not put `localhost` or the computer's address in the TV target field.

These steps follow [Samsung's TV connection guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html); the [testing FAQ](https://developer.samsung.com/smarttv/develop/faq/application-testing.html) explains the Instant On restart caveat.

## 3. Create the signing profile

In **Tools → Certificate Manager**, create a **Samsung → TV** profile named `AniHarborTV`. Create or import an author certificate, sign in to your Samsung account, then create a public distributor certificate that includes your connected TV's **DUID**. Its serial number from the sticker is not the DUID. Use Device Manager's connected-device entry to obtain the correct ID.

Keep the certificate backup and password in your own secure location outside this repository. Keep the same author certificate for later updates. In Device Manager, right-click the connected target and select **Permit to install applications**. [Samsung certificate instructions](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html), [installation permission](https://developer.samsung.com/smarttv/develop/faq/tizen-studio.html)

## 4. Build and sign

Open PowerShell in the project directory. Adjust the SDK location if necessary:

```powershell
$env:TIZEN_CLI = 'C:\tizen-studio\tools\ide\bin\tizen.bat'
node scripts/package-tv.mjs AniHarborTV
```

The script prepares the web files, runs `tizen build-web`, then signs the result with `tizen package -t wgt -s AniHarborTV`. It copies the signed output to `dist/AniHarbor.wgt`. `AniHarborTV` is a certificate **profile name**, not a password. The script never creates or stores credentials. Profile names passed to the helper must use letters, numbers, `_`, or `-`.

On a Mac with the SDK installed:

```sh
export TIZEN_CLI="$HOME/tizen-studio/tools/ide/bin/tizen"
node scripts/package-tv.mjs AniHarborTV
```

The bundled `hls.js` file is for browser testing. Samsung TV playback uses AVPlay. The manifest includes Internet and remote-key privileges; Samsung explicitly says the old `avplay` privilege is unused on 2015 and newer TVs. [AVPlay prerequisites](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html), [network permission](https://developer.samsung.com/smarttv/develop/faq/networking-and-connectivity.html)

## 5. Install and launch

In PowerShell, replace the sample TV address and then use the exact target serial reported by `sdb devices`:

```powershell
$tvAddress = '192.168.1.80'
& 'C:\tizen-studio\tools\sdb.exe' connect "$($tvAddress):26101"
& 'C:\tizen-studio\tools\sdb.exe' devices
$tvTarget = '192.168.1.80:26101'
& $env:TIZEN_CLI install -s $tvTarget -n AniHarbor.wgt -- "$PWD\dist"
& $env:TIZEN_CLI run -s $tvTarget -p AniHarbor1.AniHarbor
```

On Mac, the equivalent commands are `sdb connect TV_IP:26101`, `sdb devices`, `tizen install -s TARGET -n AniHarbor.wgt -- /path/to/project/dist`, and `tizen run -s TARGET -p AniHarbor1.AniHarbor`, using SDK tools on your PATH.

These use Samsung's documented [TV CLI commands](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html). If installation fails, verify the certificate DUID, active profile, minimum platform version, and Device Manager permission. Do not turn off certificate verification.

## 6. Pair and check playback

1. Keep `npm start` running on the server computer.
2. On the TV, open AniHarbor **Settings**. Enter `http://PC_IP:8787`, using the **server computer's** LAN address, plus the pairing token printed in its terminal. The token is also saved locally in `.data/pairing-token`.
3. Check connectivity, navigate using arrows and Enter, and test a playable episode. Check sub/dub selection, subtitle readability, pause/resume, seeking, Back, and Continue Watching.
4. Test failure recovery by selecting another configured source when one cannot load. A search result alone does not prove that source's video plays on this TV.
5. Restart the app and TV to check saved settings, progress, and whether this firmware retains the development installation.

Do not set the server address to `0.0.0.0` or `127.0.0.1`; those are not the computer's reachable LAN address. Do not forward port 8787 from your router to the Internet. The computer must remain awake while watching.

If the target firmware cannot retain a development app, the honest remaining choices are reinstalling for testing, seeking Samsung store distribution, or using an external playback device. This project does not claim to override Samsung's installation policy.

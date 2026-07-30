; Argus Windows installer (Inno Setup 6). Built by scripts/release.ts via ISCC.exe — not meant to
; be compiled by hand except when testing installer changes in isolation:
;
;   iscc installer\argus.iss /DMyAppVersion=0.1.0 /DMyAppExeSource=..\dist\Argus-v0.1.0-win-x64.exe
;
; What this buys over "just double-click Argus.exe" (see SETUP.md §7-8):
;   - A real wizard: license/dir/shortcut pages, progress bar, Add/Remove Programs entry.
;   - Installs Argus as a background Windows service by default (WinSW-driven, same mechanism as
;     the manual `--install-service` flag) — monitoring survives logout/reboot, no console window
;     ever shown, and no need to keep anything open.
;   - The dashboard shortcut launches Argus-Launcher.exe, a separate console-less binary (see
;     src/bootstrap/launcher.ts) that finds the already-running service's actual configured port
;     and opens the browser to it, nudging the service awake first if it's stopped. Never flashes
;     a console window.
;   - Uninstalling stops and removes the service, but deliberately leaves the data directory (the
;     customer's device inventory/history/settings) behind in case they reinstall later.
#define MyAppName "Argus - Network Monitoring System"
; Must match src/bootstrap/config.ts's ConfigSchema port default — this is only the value baked
; into the firewall rule created at install time, not something the app itself reads from here. If
; an operator changes the port later (Settings -> General, or PORT env var / config.json), they
; need to re-run `Argus.exe --fix-firewall` for a matching rule at the new port.
#define MyAppPort "58070"
#ifndef MyAppPublisher
  #define MyAppPublisher "Argus"
#endif
#define MyAppURL "https://github.com/shaikhsameer18/Argus"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef MyAppExeSource
  #define MyAppExeSource "..\dist\Argus.exe"
#endif
#ifndef MyAppLauncherSource
  #define MyAppLauncherSource "..\dist\Argus-Launcher.exe"
#endif

[Setup]
AppId={{A47B1E2C-6D8F-4A3B-9C2E-1F5D7E8A9B3C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
; No AppVerName: Inno's Add/Remove Programs entry uses AppVerName (name+version) when set, falling
; back to AppName otherwise — the version is still tracked (AppVersion, visible in the "Version"
; column of Programs and Features) but deliberately left out of the display name itself.
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\Argus
DefaultGroupName=Argus
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=Argus-Setup-v{#MyAppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\Argus.exe
WizardStyle=modern
Uninstallable=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to the Argus dashboard"; GroupDescription: "Additional shortcuts:"

[Code]
var
  DataDirPage: TInputDirWizardPage;

// Only asked on a genuinely fresh install — src/bootstrap/config.ts reads dataDir from config.json
// (falling back to "./data" next to the exe if that file doesn't exist), so an existing config.json
// means either an upgrade over a working install or a reinstall after uninstall-without-full-wipe;
// either way, silently changing where Argus looks for its device inventory/history mid-upgrade
// would be far more surprising than just leaving it alone.
function HasExistingConfig(): Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\config.json'));
end;

procedure InitializeWizard();
begin
  DataDirPage := CreateInputDirPage(
    wpSelectDir,
    'Choose Data Location',
    'Where should Argus store its device inventory, monitoring history, and settings?',
    'This can be on a different drive if you want monitoring data kept separate from the install ' +
      '(e.g. a larger data disk). You can''t easily move it later without manually copying the folder, ' +
      'so pick somewhere with enough free space for long-term history.',
    False, ''
  );
  DataDirPage.Add('');
  // NOT ExpandConstant('{app}\data') here — {app} isn't resolved until the wizard has actually
  // shown/passed the "Select Destination Location" page, and InitializeWizard runs before any
  // page is shown at all. Expanding {app} this early throws a runtime "attempt to expand the
  // 'app' constant before it was initialized" error. WizardDirValue() returns the same directory
  // (defaulting to DefaultDirName) without that restriction — it reads the wizard's directory
  // field directly instead of going through the constant-expansion machinery.
  DataDirPage.Values[0] := WizardDirValue() + '\data';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // Upgrade/reinstall over a working install: config.json already pins a dataDir (possibly a
  // custom one from a previous run of this same page), so don't ask again.
  if PageID = DataDirPage.ID then
    Result := HasExistingConfig()
  else
    Result := False;
end;

// JSON has no native path type, and Windows paths contain backslashes ("\"), which JSON reads as
// the start of an escape sequence — "C:\data" is invalid JSON, "C:\\data" is valid-but-ugly. This
// codebase's own convention (see src/bootstrap/config.ts callers and GUIDE.md) is to just use
// forward slashes throughout; Node/Bun accept them fine on Windows, and it keeps config.json
// human-editable without tripping over escaping.
function ToJsonPath(Path: String): String;
begin
  StringChangeEx(Path, '\', '/', True);
  Result := Path;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  ChosenDataDir: String;
begin
  // Stops the service (if one is running from a previous install) before [Files] tries to
  // overwrite Argus.exe / Argus-service.exe — Windows locks a running process's own binary, so
  // running this installer over an existing service install without this would fail partway
  // through with a "file in use" error instead of just working. This IS the "how do I update"
  // answer: run the newer installer over the old one, no uninstall needed, data directory is
  // never touched by [UninstallDelete] anyway. Exit code ignored on purpose — must be a silent
  // no-op on a fresh install where the service doesn't exist yet, not a failure.
  if CurStep = ssInstall then begin
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop Argus', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // "sc stop" returns as soon as the stop is requested, not once the process has actually
    // exited and released its file handles — a fixed pause here is cheaper and more robust than
    // polling "sc query" for STOPPED, for a process this lightweight.
    if ResultCode = 0 then Sleep(2000);
  end;

  // Runs after [Files] but before [Run] (which is what actually invokes --install-service), so the
  // service picks up the chosen path from the moment it first starts rather than defaulting to
  // {app}\data and needing a manual edit + restart afterward.
  if (CurStep = ssPostInstall) and (not HasExistingConfig()) then begin
    ChosenDataDir := DataDirPage.Values[0];
    ForceDirectories(ChosenDataDir);
    SaveStringToFile(
      ExpandConstant('{app}\config.json'),
      '{' + #13#10 + '  "dataDir": "' + ToJsonPath(ChosenDataDir) + '"' + #13#10 + '}' + #13#10,
      False
    );
  end;
end;

[Files]
Source: "{#MyAppExeSource}"; DestDir: "{app}"; DestName: "Argus.exe"; Flags: ignoreversion
Source: "{#MyAppLauncherSource}"; DestDir: "{app}"; DestName: "Argus-Launcher.exe"; Flags: ignoreversion
; WinSW service wrapper (see src/bootstrap/service.ts) — place a copy at tools\Argus-service.exe
; before building the installer. Silently skipped if absent, in which case --install-service falls
; back to printing the manual one-time setup step (same as a from-source build).
Source: "..\tools\Argus-service.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\Argus"; Filename: "{app}\Argus-Launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Argus.exe"
Name: "{group}\Uninstall Argus"; Filename: "{uninstallexe}"
Name: "{commondesktop}\Argus"; Filename: "{app}\Argus-Launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Argus.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Argus.exe"; Parameters: "--install-service"; WorkingDir: "{app}"; StatusMsg: "Registering Argus as a background service…"; Flags: runhidden waituntilterminated
; Without this, the dashboard is only reachable from the machine it's installed on: Windows
; Firewall blocks unsolicited inbound connections by default, and since Argus runs as a
; non-interactive background service there's never an interactive "Allow this app?" prompt for
; someone to click through — a colleague on the LAN hitting http://<this-pc>:{#MyAppPort} would
; just silently time out. Same two commands src/bootstrap/firewall.ts's --fix-firewall prints,
; just applied automatically instead of requiring a manual copy-paste step. Kept as separate rule
; entries (not a single combined one) so uninstall can remove them individually by name.
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""Argus HTTP"" dir=in action=allow protocol=TCP localport={#MyAppPort}"; StatusMsg: "Allowing Argus through Windows Firewall…"; Flags: runhidden
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""Argus ICMP Echo"" protocol=icmpv4:8,any dir=in action=allow"; Flags: runhidden
Filename: "{app}\Argus-Launcher.exe"; WorkingDir: "{app}"; Description: "Open the Argus dashboard now"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\Argus.exe"; Parameters: "--uninstall-service"; WorkingDir: "{app}"; RunOnceId: "ArgusUninstallService"; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Argus HTTP"""; RunOnceId: "ArgusRemoveFirewallHttp"; Flags: runhidden
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Argus ICMP Echo"""; RunOnceId: "ArgusRemoveFirewallIcmp"; Flags: runhidden

[UninstallDelete]
; Files Argus writes at runtime next to itself (config, service wrapper's own logs) that Inno
; doesn't know it installed. Deliberately NOT deleting the "data" folder — that's the customer's
; device inventory, alert history, and settings, and should survive an uninstall/reinstall.
Type: files; Name: "{app}\config.json"
Type: files; Name: "{app}\Argus-service.xml"
Type: filesandordirs; Name: "{app}\Argus-service.wrapper.log"

; OWL — NSIS hooks, included by electron-builder (package.json → build.nsis.include).
;
; Why: electron-builder's own "is the app running?" check (FIND_PROCESS in
; allowOnlyOneInstallerInstance.nsh, app-builder-lib 26.18.0) counts processes with
; `(Get-CimInstance ... | ? {...}).Count -gt 0`. In Windows PowerShell 5.1 `.Count` on a single
; CimInstance is empty, so ONE leftover OWL.exe (e.g. a main process stuck while quitting, or a
; window that never became visible) is reported as "not running", is never killed, and the install
; then fails with "OWL cannot be closed..." / "Error opening file for writing ...\Uninstall OWL.exe".
; (electron-userland/electron-builder#10454)
;
; customInit runs in .onInit, i.e. before that check and before the old uninstaller runs.
; We first ask OWL to close normally (WM_CLOSE, so it can save the session), then force-kill
; whatever is left by image name, for the current user only. Never with taskkill /T: when the
; installer was started by OWL (electron-updater quitAndInstall, or opened from OWL's downloads)
; it is a child of OWL.exe and a tree kill would kill the installer itself.

!macro owlStopRunningApp
  Push $0
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop $0
  ${if} $0 == 0
    DetailPrint `Closing running "${PRODUCT_NAME}"...`
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $0
    Sleep 2000
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $0
    ; give Windows a moment to release file handles on OWL.exe / app.asar
    Sleep 1000
  ${endIf}
  Pop $0
!macroend

!macro customInit
  !insertmacro owlStopRunningApp
  ; a stale old uninstaller (run in place by uninstallOldVersion) locks "Uninstall OWL.exe"
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "Uninstall ${PRODUCT_FILENAME}.exe"`
  Pop $0
!macroend

!macro customUnInit
  !insertmacro owlStopRunningApp
!macroend

; Replace electron-builder's CHECK_APP_RUNNING (install + uninstall) with a stronger one.
; Their version can fail to kill: per-user taskkill filter, PowerShell .Count bug, and a path
; prefix match without the trailing backslash. Ours: graceful close, then force-kill (no /T: an
; installer started by OWL, e.g. an auto-update, is its child) by image name AND by path inside
; "$INSTDIR\" (any user we have rights for, never ourselves), retrying for
; ~12 s before ever asking the user.
!macro customCheckAppRunning
  !define /redef owlCK ${__COUNTER__}
  Push $R1
  Push $R2
  Push $R3
  ; our own PID: this installer/uninstaller may itself live inside $INSTDIR (an in-place old
  ; uninstaller, or a setup saved into the install folder) and must never kill itself
  System::Call 'kernel32::GetCurrentProcessId() i .R3'
  StrCpy $R1 0
  owlKillLoop_${owlCK}:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R2
    ${if} $R2 != 0
      Goto owlKillDone_${owlCK}
    ${endIf}
    ${if} $R1 == 0
      DetailPrint `Closing running "${PRODUCT_NAME}"...`
      nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}"`
      Pop $R2
      Sleep 1500
    ${endIf}
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $R2
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -C "$$d = '$INSTDIR'.TrimEnd('\') + '\'; Get-CimInstance Win32_Process | ? { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d, 'OrdinalIgnoreCase') -and $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $R3 } | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $R2
    Sleep 1000
    IntOp $R1 $R1 + 1
    ${if} $R1 < 10
      Goto owlKillLoop_${owlCK}
    ${endIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY owlKillRetry_${owlCK}
    Quit
  owlKillRetry_${owlCK}:
    StrCpy $R1 1
    Goto owlKillLoop_${owlCK}
  owlKillDone_${owlCK}:
  !ifndef BUILD_UNINSTALLER
    ; A per-user (non-elevated) install into a folder the user can't write to (e.g. one made by an
    ; earlier "run as administrator" install, or a locked-down D:\ drive) otherwise fails much later
    ; with "OWL cannot be closed" + "Error opening file for writing ...\Uninstall OWL.exe".
    ; Probe with a fresh file first and say what is actually wrong.
    owlWriteProbe_${owlCK}:
      ClearErrors
      CreateDirectory "$INSTDIR"
      FileOpen $R2 "$INSTDIR\.owl-install-test" w
      ${if} ${Errors}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Windows does not let this installer write to:$\r$\n$INSTDIR$\r$\n$\r$\nChoose a folder you own (the default is fine), install for all users, or run the installer as administrator." /SD IDCANCEL IDRETRY owlWriteProbe_${owlCK}
        Quit
      ${endIf}
      FileClose $R2
      Delete "$INSTDIR\.owl-install-test"
      ClearErrors
  !endif
  Pop $R3
  Pop $R2
  Pop $R1
  !undef owlCK
!macroend

; An old uninstaller (from a build before these hooks) can still exit non-zero during an upgrade,
; e.g. its own buggy running-app check matched this installer or a file was briefly locked by
; antivirus. electron-builder's default then shows "uninstall failed" and quits, leaving OWL
; half-removed. OWL is already stopped at this point and every file is about to be overwritten,
; so log it and carry on with the install instead.
!macro owlUninstallResult
  ${if} ${Errors}
    DetailPrint `Old OWL uninstaller could not be launched; installing over it.`
  ${elseif} $R0 != 0
    DetailPrint `Old OWL uninstaller exited with code $R0; installing over it.`
  ${endIf}
  ClearErrors
!macroend

!macro customUnInstallCheck
  !insertmacro owlUninstallResult
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro owlUninstallResult
!macroend

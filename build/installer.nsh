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
; whatever is left, the whole process tree, for the current user only.

!macro owlStopRunningApp
  Push $0
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop $0
  ${if} $0 == 0
    DetailPrint `Closing running "${PRODUCT_NAME}"...`
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $0
    Sleep 2000
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $0
    ; give Windows a moment to release file handles on OWL.exe / app.asar
    Sleep 1000
  ${endIf}
  Pop $0
!macroend

!macro customInit
  !insertmacro owlStopRunningApp
!macroend

!macro customUnInit
  !insertmacro owlStopRunningApp
!macroend

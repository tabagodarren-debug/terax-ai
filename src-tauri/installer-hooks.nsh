; "Open in Afflow" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAfflow" "" "Open in Afflow"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAfflow" "Icon" '"$INSTDIR\afflow.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAfflow" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAfflow\command" "" '"$INSTDIR\afflow.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAfflow" "" "Open in Afflow"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAfflow" "Icon" '"$INSTDIR\afflow.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAfflow" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAfflow\command" "" '"$INSTDIR\afflow.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAfflow" "" "Open in Afflow"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAfflow" "Icon" '"$INSTDIR\afflow.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAfflow" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAfflow\command" "" '"$INSTDIR\afflow.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInAfflow"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInAfflow"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInAfflow"
!macroend

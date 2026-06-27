!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var GLLMInstallMode
Var GLLMDataRoot
Var GLLMDefaultDataRoot
Var GLLMModeDialog
Var GLLMModeIntroLabel
Var GLLMNormalRadio
Var GLLMNormalDescLabel
Var GLLMPortableRadio
Var GLLMPortableDescLabel
Var GLLMBrandLabel
Var GLLMDataDialog
Var GLLMDataIntroLabel
Var GLLMDataInput
Var GLLMDataBrowseButton

LangString GLLMInstallModePageTitle 1033 "Choose installation mode"
LangString GLLMInstallModePageTitle 2052 "选择安装模式"
LangString GLLMInstallModePageSubtitle 1033 "Choose Standard or Portable before selecting folders."
LangString GLLMInstallModePageSubtitle 2052 "先选择普通版或便携版，再选择对应目录。"
LangString GLLMInstallModeIntro 1033 "G-LLM keeps assistants, conversations, knowledge base and settings locally. Pick the storage style that matches how you use this computer."
LangString GLLMInstallModeIntro 2052 "G-LLM 会把助手、会话、知识库和配置保存在本机。请选择适合当前电脑使用方式的版本。"
LangString GLLMInstallModeNormal 1033 "Standard installation (recommended)"
LangString GLLMInstallModeNormal 2052 "普通版（推荐）"
LangString GLLMInstallModeNormalDesc 1033 "Program files: C:\Program Files\GProphet\G-LLM. User data: %APPDATA%\G-LLM by default, and you can choose another data folder."
LangString GLLMInstallModeNormalDesc 2052 "程序默认安装到 C:\Program Files\GProphet\G-LLM；用户数据默认在 %APPDATA%\G-LLM，也可以另选数据目录。"
LangString GLLMInstallModePortable 1033 "Portable installation"
LangString GLLMInstallModePortable 2052 "便携版"
LangString GLLMInstallModePortableDesc 1033 "Program files and user data stay together. Data folder: Install folder\UserData. Good for USB drives or moving the whole folder."
LangString GLLMInstallModePortableDesc 2052 "程序和用户数据放在一起。数据目录：安装目录\UserData，适合 U 盘或整体迁移。"
LangString GLLMInstallModeBrand 1033 "Global Intelligence, Limitless Possibilities. Connect your own model gateway and keep your workspace local."
LangString GLLMInstallModeBrand 2052 "Global Intelligence, Limitless Possibilities。连接你的模型网关，把工作空间留在本地。"

LangString GLLMDataDirPageTitle 1033 "Choose data folder"
LangString GLLMDataDirPageTitle 2052 "选择数据目录"
LangString GLLMDataDirPageSubtitle 1033 "This folder stores conversations, assistants, knowledge base and provider settings."
LangString GLLMDataDirPageSubtitle 2052 "该目录保存会话、助手、本地知识库和供应商配置。"
LangString GLLMDataDirIntro 1033 "Standard mode separates program files from user data. The default is %APPDATA%\G-LLM. You may choose another writable folder."
LangString GLLMDataDirIntro 2052 "普通版会把程序文件和用户数据分开。默认目录是 %APPDATA%\G-LLM，你也可以选择其他可写目录。"
LangString GLLMDataDirLabel 1033 "Data folder:"
LangString GLLMDataDirLabel 2052 "数据目录："
LangString GLLMDataDirBrowse 1033 "Browse..."
LangString GLLMDataDirBrowse 2052 "浏览..."
LangString GLLMDataDirBrowseTitle 1033 "Choose G-LLM data folder"
LangString GLLMDataDirBrowseTitle 2052 "选择 G-LLM 数据目录"
LangString GLLMDataDirEmptyWarning 1033 "Please choose a data folder."
LangString GLLMDataDirEmptyWarning 2052 "请选择数据目录。"
LangString GLLMDataDirProgramFilesWarning 1033 "The data folder cannot be inside Program Files. Please choose a writable user folder."
LangString GLLMDataDirProgramFilesWarning 2052 "数据目录不能放在 Program Files 内，请选择一个普通用户可写的目录。"
LangString GLLMPortableDataPageTitle 1033 "Portable data folder"
LangString GLLMPortableDataPageTitle 2052 "便携版数据目录"
LangString GLLMPortableDataPageSubtitle 1033 "Portable mode stores data under the installation folder."
LangString GLLMPortableDataPageSubtitle 2052 "便携版会把数据保存在安装目录下。"
LangString GLLMPortableDataIntro 1033 "G-LLM will store user data in Install folder\UserData. Please avoid Program Files for portable mode."
LangString GLLMPortableDataIntro 2052 "G-LLM 会把用户数据保存在安装目录\UserData。便携版请不要安装到 Program Files。"
LangString GLLMPortableProgramFilesWarning 1033 "Portable mode stores data in the installation folder. Please go back and choose a writable folder outside Program Files, for example D:\G-LLM."
LangString GLLMPortableProgramFilesWarning 2052 "便携版会把数据写入安装目录。请返回上一步，选择 Program Files 之外的可写目录，例如 D:\G-LLM。"

!macro customWelcomePage
  Page custom GLLMInstallModePage GLLMInstallModeLeave
!macroend

!macro customPageAfterChangeDir
  Page custom GLLMDataDirPage GLLMDataDirLeave
!macroend

Function GLLMSetHeader
  Pop $1
  Pop $0
  GetDlgItem $2 $HWNDPARENT 1037
  SendMessage $2 0x000C 0 "STR:$0"
  GetDlgItem $2 $HWNDPARENT 1038
  SendMessage $2 0x000C 0 "STR:$1"
FunctionEnd

Function GLLMSetNormalInstallDir
  ${If} "$PROGRAMFILES64" != ""
    StrCpy $INSTDIR "$PROGRAMFILES64\GProphet\G-LLM"
  ${Else}
    StrCpy $INSTDIR "$PROGRAMFILES\GProphet\G-LLM"
  ${EndIf}
FunctionEnd

Function GLLMSetPortableInstallDir
  StrCpy $INSTDIR "$PROFILE\G-LLM"
FunctionEnd

Function GLLMInstallModePage
  Push "$(GLLMInstallModePageTitle)"
  Push "$(GLLMInstallModePageSubtitle)"
  Call GLLMSetHeader

  nsDialogs::Create 1018
  Pop $GLLMModeDialog
  ${If} $GLLMModeDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 30u "$(GLLMInstallModeIntro)"
  Pop $GLLMModeIntroLabel

  ${NSD_CreateRadioButton} 0 38u 100% 14u "$(GLLMInstallModeNormal)"
  Pop $GLLMNormalRadio
  ${NSD_CreateLabel} 18u 57u 92% 34u "$(GLLMInstallModeNormalDesc)"
  Pop $GLLMNormalDescLabel

  ${NSD_CreateRadioButton} 0 99u 100% 14u "$(GLLMInstallModePortable)"
  Pop $GLLMPortableRadio
  ${NSD_CreateLabel} 18u 118u 92% 30u "$(GLLMInstallModePortableDesc)"
  Pop $GLLMPortableDescLabel

  ${NSD_CreateLabel} 0 158u 100% 18u "$(GLLMInstallModeBrand)"
  Pop $GLLMBrandLabel

  ${If} $GLLMInstallMode == "portable"
    ${NSD_Check} $GLLMPortableRadio
  ${Else}
    StrCpy $GLLMInstallMode "normal"
    ${NSD_Check} $GLLMNormalRadio
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function GLLMInstallModeLeave
  ${NSD_GetState} $GLLMPortableRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $GLLMInstallMode "portable"
    Call GLLMSetPortableInstallDir
  ${Else}
    StrCpy $GLLMInstallMode "normal"
    Call GLLMSetNormalInstallDir
  ${EndIf}

  StrCpy $GLLMDefaultDataRoot "$APPDATA\G-LLM"
  StrCpy $GLLMDataRoot "$GLLMDefaultDataRoot"
FunctionEnd

Function GLLMDataDirPage
  ${If} $GLLMInstallMode == "portable"
    Push "$(GLLMPortableDataPageTitle)"
    Push "$(GLLMPortableDataPageSubtitle)"
    Call GLLMSetHeader
  ${Else}
    Push "$(GLLMDataDirPageTitle)"
    Push "$(GLLMDataDirPageSubtitle)"
    Call GLLMSetHeader
  ${EndIf}

  nsDialogs::Create 1018
  Pop $GLLMDataDialog
  ${If} $GLLMDataDialog == error
    Abort
  ${EndIf}

  ${If} $GLLMInstallMode == "portable"
    StrCpy $GLLMDataRoot "$INSTDIR\UserData"
    ${NSD_CreateLabel} 0 0 100% 34u "$(GLLMPortableDataIntro)"
    Pop $GLLMDataIntroLabel
    ${NSD_CreateLabel} 0 48u 100% 14u "$(GLLMDataDirLabel)"
    Pop $0
    ${NSD_CreateLabel} 0 68u 100% 30u "$GLLMDataRoot"
    Pop $0
  ${Else}
    ${If} $GLLMDataRoot == ""
      StrCpy $GLLMDataRoot "$APPDATA\G-LLM"
    ${EndIf}
    StrCpy $GLLMDefaultDataRoot "$APPDATA\G-LLM"
    ${NSD_CreateLabel} 0 0 100% 34u "$(GLLMDataDirIntro)"
    Pop $GLLMDataIntroLabel
    ${NSD_CreateLabel} 0 48u 100% 14u "$(GLLMDataDirLabel)"
    Pop $0
    ${NSD_CreateDirRequest} 0 68u 78% 14u "$GLLMDataRoot"
    Pop $GLLMDataInput
    ${NSD_CreateBrowseButton} 82% 67u 18% 16u "$(GLLMDataDirBrowse)"
    Pop $GLLMDataBrowseButton
    ${NSD_OnClick} $GLLMDataBrowseButton GLLMDataDirBrowse
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function GLLMDataDirBrowse
  Pop $0
  ${NSD_GetText} $GLLMDataInput $1
  nsDialogs::SelectFolderDialog "$(GLLMDataDirBrowseTitle)" "$1"
  Pop $2
  ${If} $2 != error
    ${NSD_SetText} $GLLMDataInput $2
  ${EndIf}
FunctionEnd

Function GLLMValidateDataRoot
  ${If} $GLLMDataRoot == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMDataDirEmptyWarning)"
    Abort
  ${EndIf}

  StrCpy $3 "$PROGRAMFILES\"
  StrLen $1 $3
  StrCpy $2 "$GLLMDataRoot\" $1
  ${If} $2 == $3
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMDataDirProgramFilesWarning)"
    Abort
  ${EndIf}

  ${If} "$PROGRAMFILES64" != ""
    StrCpy $3 "$PROGRAMFILES64\"
    StrLen $1 $3
    StrCpy $2 "$GLLMDataRoot\" $1
    ${If} $2 == $3
      MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMDataDirProgramFilesWarning)"
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Function GLLMDataDirLeave
  ${If} $GLLMInstallMode == "portable"
    StrCpy $GLLMDataRoot "$INSTDIR\UserData"
    StrCpy $3 "$PROGRAMFILES\"
    StrLen $1 $3
    StrCpy $2 "$INSTDIR\" $1
    ${If} $2 == $3
      MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMPortableProgramFilesWarning)"
      Abort
    ${EndIf}

    ${If} "$PROGRAMFILES64" != ""
      StrCpy $3 "$PROGRAMFILES64\"
      StrLen $1 $3
      StrCpy $2 "$INSTDIR\" $1
      ${If} $2 == $3
        MessageBox MB_ICONEXCLAMATION|MB_OK "$(GLLMPortableProgramFilesWarning)"
        Abort
      ${EndIf}
    ${EndIf}
  ${Else}
    ${NSD_GetText} $GLLMDataInput $GLLMDataRoot
    Call GLLMValidateDataRoot
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $GLLMInstallMode == "portable"
    CreateDirectory "$INSTDIR\UserData"
    FileOpen $0 "$INSTDIR\portable.flag" w
    FileWrite $0 "portable"
    FileClose $0
    SetFileAttributes "$INSTDIR\portable.flag" HIDDEN
    FileOpen $0 "$INSTDIR\UserData\README.txt" w
    FileWrite $0 "G-LLM 便携版数据目录。聊天记录、助手、本地知识库、长期记忆和供应商配置会保存在这里。迁移软件时，请移动整个安装目录。$\r$\n"
    FileClose $0
  ${Else}
    Delete "$INSTDIR\portable.flag"
    StrCpy $GLLMDefaultDataRoot "$APPDATA\G-LLM"
    ${If} $GLLMDataRoot == ""
      StrCpy $GLLMDataRoot "$GLLMDefaultDataRoot"
    ${EndIf}
    CreateDirectory "$GLLMDefaultDataRoot"
    CreateDirectory "$GLLMDataRoot"
    ${If} $GLLMDataRoot == $GLLMDefaultDataRoot
      Delete "$GLLMDefaultDataRoot\data-location.txt"
      Delete "$GLLMDefaultDataRoot\data-location.json"
    ${Else}
      FileOpen $0 "$GLLMDefaultDataRoot\data-location.txt" w
      FileWrite $0 "$GLLMDataRoot"
      FileClose $0
    ${EndIf}
  ${EndIf}
!macroend
!endif

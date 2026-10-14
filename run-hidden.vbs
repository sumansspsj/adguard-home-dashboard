Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
serverDir = strPath & "\server"
WshShell.CurrentDirectory = serverDir

nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodeExe = """C:\Program Files\nodejs\node.exe"""
End If

WshShell.Run nodeExe & " index.js", 0, False
Set WshShell = Nothing

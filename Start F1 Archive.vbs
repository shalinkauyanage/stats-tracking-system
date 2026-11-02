
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

projectPath = FSO.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = projectPath & "\server"
WshShell.Run "cmd /c npm start", 0, False

WScript.Sleep 3000

WshShell.CurrentDirectory = projectPath & "\frontend"
WshShell.Run "cmd /c npm run dev -- --port 5173", 0, False

WScript.Sleep 4000

WshShell.Run "http://localhost:5173", 1, False

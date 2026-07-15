' Lance la vérification sans faire apparaître de fenêtre de terminal.
' Détecte automatiquement son propre dossier, donc ce fichier peut être
' déplacé n'importe où tant qu'il reste à la racine du projet (à côté de
' package.json et du dossier src/).
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run "node """ & scriptDir & "\src\runAndNotify.js""", 0, False

## 📄 Requirements Document: Tasks Auto-Dependency Linker (v2.0)

### 1. Zielsetzung (Project Goal)

Automatisierung von Aufgaben-Abhängigkeiten im **Obsidian Tasks Plugin** basierend auf der visuellen Markdown-Struktur. Einrücken = Blockieren; Ausrücken = Freigeben.

### 2. System-Kontext & Abhängigkeiten

- **Host-App:** Obsidian.md (Desktop & Mobile).
    
- **Kern-Abhängigkeit:** Erfordert das installierte **Obsidian Tasks Plugin**.
    
- **Syntax-Kompatibilität:** Muss die Emojis `🆔` (ID) und `⛔` (Depends on) gemäß Tasks-Standard unterstützen.
    
- **Distributions-Ziel:** Offizielles **Obsidian Community Plugin** Listing.

### 3. Funktionale Anforderungen (Logic Flow)

#### A. Editor-Überwachung (Indentation Logic)

- **Trigger:** Reagiere auf `editor-change` Events (debounced, 300ms). Erfasst alle Einrückungsänderungen: `Tab`, `Shift+Tab`, Paste, Drag-Drop, externe Edits.
    
- **Einrücken (Task A -> Task B):**
    
    1. Prüfe, ob die Zeile über dem Cursor (Parent) ein Task ist.
        
    2. Falls Parent keine `🆔` hat: Generiere eine 6-stellige alphanumerische ID und hänge sie an den Parent an.
        
    3. Hänge an den aktuellen Task (Child) `⛔ [Parent-ID]` an.
        
- **Ausrücken:**
    
    1. Entferne den `⛔ [ID]` String des **alten Parents** aus dem aktuellen Task, sobald die Einrückungsebene verringert wird.
        
    2. Prüfe, ob auf der neuen Einrückungsebene ein neuer Parent existiert. Falls ja, verknüpfe mit dem neuen Parent.
        
    3. **Wichtig:** Bestehende `🆔` Marker werden niemals automatisch gelöscht, um Datenverlust bei anderen Verknüpfungen zu vermeiden.
        
    4. **Wichtig:** Manuell gesetzte `⛔` Marker, die nicht dem alten Parent zugeordnet sind, bleiben erhalten.

#### B. Abhängigkeits-Regeln (Dependency Rules)

- **Eltern-Kind-Beziehung:** Nur direkte Parent-Child-Beziehungen. Ein Child blockt seinen unmittelbaren Parent. Dadurch ergibt sich bei A -> B -> C implizit A -> C (transitiv).
    
- **Geschwister:** Kinder desselben Parents sind voneinander unabhängig. Alle Kinder blocken den Parent, aber nicht einander.
    
- **Nicht-Task-Zeilen:** Normale Textzeilen, Bullets ohne Checkbox und sonstige Nicht-Task-Zeilen werden komplett ignoriert, auch wenn sie eingerückt sind.

#### C. ID-Generierung (ID Engine)

- **Automatisch:** IDs werden immer automatisch generiert, wenn ein Parent keine `🆔` hat. Es gibt keinen An/Aus-Schalter.
    
- **Bestehende IDs:** Wenn ein Parent bereits eine `🆔` hat, wird diese verwendet (keine neue generiert).
    
- **Eindeutigkeit:** IDs müssen **vault-weit** eindeutig sein (nicht nur pro Dokument).
    
- **Format:** 6-stellig, lowercase alphanumerisch (`[a-z0-9]{6}`), ~2.18 Milliarden Kombinationen.

#### D. Plugin-Sicherheit & Performance

- **Scope:** Verwende niemals globale Variablen (kein `window.app`). Nutze ausschließlich `this.app`.
    
- **Cleanup:** Alle Event-Listener müssen beim Entladen des Plugins (`onunload`) sauber mit `this.registerEvent()` oder manuell entfernt werden.
    
- **Debouncing:** Editor-Änderungen werden mit 300ms Debounce behandelt, um die Performance bei schnellem Tippen nicht zu beeinträchtigen.
    
- **Transactions:** Alle Editor-Modifikationen werden in `editor.transaction()` gruppiert, damit sie als ein einzelner Undo-Schritt gelten.

#### E. Settings

- **Keine Settings-UI in v1.** Plugin an = Feature an. Plugin aus = Feature aus. Kann in zukünftigen Versionen erweitert werden.

### 4. Technische Spezifikationen (Community Standards)

#### Source-Struktur

```
src/
├── main.ts                  # Plugin Entry Point + Event-Wiring
├── task-parser.ts           # Regex-Parsing, Zeilen-Manipulation
├── id-engine.ts             # Vault-weite eindeutige ID-Generierung + Cache
├── indentation-handler.ts   # Indent/Outdent-Erkennung + Linking-Logik
└── utils.ts                 # Debounce Helper
```

#### Datei-Struktur Für Release

- `manifest.json`: ID, Name, Version (SemVer), Author, Repo-URL.
    
- `main.js`: Der mit `esbuild` kompilierte Code (kein TypeScript im Release!).
    
- `styles.css`: (Optional) Falls UI-Anpassungen nötig sind.
    
- `LICENSE`: Open-Source (vorzugsweise MIT).

#### Regex-Konstanten

- `TASK_REGEX`: `/^\s*([-*]\s\[.\]\s)/`
    
- `ID_REGEX`: `/🆔\s([a-z0-9]{6})/`
    
- `DEP_REGEX`: `/⛔\s([a-z0-9]{6})/g` (global Flag, da mehrere `⛔` pro Zeile möglich sind)

### 5. Deployment-Anforderungen (Store-Listing)

1. **GitHub Release:** Ein Tag (z. B. `1.0.0`) muss erstellt werden.
    
2. **Assets:** `main.js`, `manifest.json` und `styles.css` müssen als Binärdateien im Release-Asset hängen.
    
3. **PR an Obsidian-Releases:** Eintragung der Plugin-ID in die `community-plugins.json` des offiziellen Repos.



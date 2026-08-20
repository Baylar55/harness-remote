import type { LanguageCode } from "./i18n"

/**
 * TaskDesk keeps its own dictionary rather than extending Classic's.
 *
 * Two reasons. Classic's table is one block per language, which lets a key exist in English and
 * quietly fall back everywhere else; here every entry carries all four locales in one literal, so a
 * missing translation is a type error instead of a runtime fallback. And keeping the product-shell
 * copy separate means TaskDesk wording can change without touching the strings the shipped 2.x
 * surface depends on.
 *
 * `Task` and `Run` stay untranslated in Italian: they are the product's object names, the same way
 * the app is called TaskDesk, and the Task -> Run -> Session hierarchy only reads as a hierarchy if
 * the nouns are stable. `Session` follows Classic, which already ships `Sessione` / 工作階段 / 会话.
 */
type Entry = Record<LanguageCode, string>

const dictionary = {
  "brand.name": { en: "TaskDesk", it: "TaskDesk", "zh-TW": "TaskDesk", "zh-CN": "TaskDesk" },
  "brand.product": { en: "Harness Remote", it: "Harness Remote", "zh-TW": "Harness Remote", "zh-CN": "Harness Remote" },

  "nav.overview": { en: "Overview", it: "Panoramica", "zh-TW": "總覽", "zh-CN": "总览" },
  "nav.tasks": { en: "Tasks", it: "Task", "zh-TW": "任務", "zh-CN": "任务" },
  "nav.sessions": { en: "Sessions", it: "Sessioni", "zh-TW": "工作階段", "zh-CN": "会话" },
  "nav.projects": { en: "Projects", it: "Progetti", "zh-TW": "專案", "zh-CN": "项目" },
  "nav.needs": { en: "Needs You", it: "Richiede te", "zh-TW": "需要你", "zh-CN": "需要你" },
  "nav.agents": { en: "Agents", it: "Agenti", "zh-TW": "代理", "zh-CN": "代理" },
  "nav.machines": { en: "Machines", it: "Macchine", "zh-TW": "機器", "zh-CN": "机器" },
  "nav.more": { en: "More", it: "Altro", "zh-TW": "更多", "zh-CN": "更多" },
  "nav.settings": { en: "Settings", it: "Impostazioni", "zh-TW": "設定", "zh-CN": "设置" },
  "nav.classic": { en: "Classic 2.x", it: "Classica 2.x", "zh-TW": "經典 2.x", "zh-CN": "经典 2.x" },
  "nav.manageMachines": { en: "Manage machines", it: "Gestisci macchine", "zh-TW": "管理機器", "zh-CN": "管理机器" },
  "nav.close": { en: "Close", it: "Chiudi", "zh-TW": "關閉", "zh-CN": "关闭" },
  "nav.moreTitle": { en: "More", it: "Altro", "zh-TW": "更多", "zh-CN": "更多" },
  "nav.moreHint": {
    en: "Everything the bottom bar cannot hold.",
    it: "Tutto ciò che la barra inferiore non può contenere.",
    "zh-TW": "底部列容納不了的其他項目。",
    "zh-CN": "底部栏容纳不了的其他项目。"
  },

  "machine.all": { en: "All machines", it: "Tutte le macchine", "zh-TW": "所有機器", "zh-CN": "所有机器" },
  "machine.online": { en: "Online", it: "Online", "zh-TW": "已連線", "zh-CN": "已连接" },
  "machine.offline": { en: "Offline", it: "Offline", "zh-TW": "離線", "zh-CN": "离线" },
  "machine.onlineCount": { en: "{online}/{total} online", it: "{online}/{total} online", "zh-TW": "{online}/{total} 已連線", "zh-CN": "{online}/{total} 已连接" },
  "machine.scopeLabel": { en: "Machine scope", it: "Ambito macchina", "zh-TW": "機器範圍", "zh-CN": "机器范围" },
  "machine.notDaemon": {
    en: "Not a Harness machine daemon",
    it: "Non è un daemon macchina Harness",
    "zh-TW": "這不是 Harness 機器常駐服務",
    "zh-CN": "这不是 Harness 机器守护进程"
  },

  "search.placeholder": {
    en: "Search Tasks, projects, agents…",
    it: "Cerca Task, progetti, agenti…",
    "zh-TW": "搜尋任務、專案、代理…",
    "zh-CN": "搜索任务、项目、代理…"
  },

  "action.newTask": { en: "New Task", it: "Nuovo Task", "zh-TW": "新增任務", "zh-CN": "新建任务" },
  "action.newSession": { en: "New Session", it: "Nuova Sessione", "zh-TW": "新增工作階段", "zh-CN": "新建会话" },
  "action.refresh": { en: "Refresh", it: "Aggiorna", "zh-TW": "重新整理", "zh-CN": "刷新" },
  "action.cancel": { en: "Cancel", it: "Annulla", "zh-TW": "取消", "zh-CN": "取消" },
  "action.retry": { en: "Retry", it: "Riprova", "zh-TW": "重試", "zh-CN": "重试" },
  "action.openSession": { en: "Open Session", it: "Apri Sessione", "zh-TW": "開啟工作階段", "zh-CN": "打开会话" },
  "action.continue": { en: "Continue", it: "Continua", "zh-TW": "繼續", "zh-CN": "继续" },
  "action.finishTask": { en: "Finish Task", it: "Concludi Task", "zh-TW": "完成任務", "zh-CN": "完成任务" },
  "action.cleanupWorkspace": { en: "Cleanup Workspace", it: "Pulisci workspace", "zh-TW": "清理工作區", "zh-CN": "清理工作区" },
  "action.viewAll": { en: "View all", it: "Vedi tutto", "zh-TW": "查看全部", "zh-CN": "查看全部" },
  "action.reject": { en: "Reject", it: "Rifiuta", "zh-TW": "拒絕", "zh-CN": "拒绝" },
  "action.once": { en: "Once", it: "Una volta", "zh-TW": "允許一次", "zh-CN": "允许一次" },
  "action.always": { en: "Always", it: "Sempre", "zh-TW": "一律允許", "zh-CN": "始终允许" },
  "action.answer": { en: "Answer", it: "Rispondi", "zh-TW": "回答", "zh-CN": "回答" },
  "action.sending": { en: "Sending…", it: "Invio…", "zh-TW": "正在傳送…", "zh-CN": "正在发送…" },
  "action.backToTasks": { en: "Back to Tasks", it: "Torna ai Task", "zh-TW": "返回任務", "zh-CN": "返回任务" },
  "action.backToSessions": { en: "Back to Sessions", it: "Torna alle Sessioni", "zh-TW": "返回工作階段", "zh-CN": "返回会话" },

  "overview.eyebrow": { en: "Control plane", it: "Piano di controllo", "zh-TW": "控制平面", "zh-CN": "控制平面" },
  "overview.title": { en: "Overview", it: "Panoramica", "zh-TW": "總覽", "zh-CN": "总览" },
  "overview.subtitle": {
    en: "Durable Tasks, native Sessions and every coding harness in one place.",
    it: "Task durevoli, Sessioni native e ogni harness di coding in un unico posto.",
    "zh-TW": "持久任務、原生工作階段與所有編碼 harness 集中一處。",
    "zh-CN": "持久任务、原生会话与所有编码 harness 集中一处。"
  },
  "kpi.working": { en: "Working", it: "In lavorazione", "zh-TW": "進行中", "zh-CN": "进行中" },
  "kpi.workingHint": { en: "active Task runs", it: "Run di Task attivi", "zh-TW": "進行中的任務 Run", "zh-CN": "进行中的任务 Run" },
  "kpi.review": { en: "Ready for review", it: "Pronti per revisione", "zh-TW": "待審閱", "zh-CN": "待审阅" },
  "kpi.reviewHint": { en: "completed Runs awaiting you", it: "Run completati in attesa di te", "zh-TW": "已完成、等待你的 Run", "zh-CN": "已完成、等待你的 Run" },
  "kpi.needsHint": { en: "questions and permissions", it: "domande e permessi", "zh-TW": "問題與權限請求", "zh-CN": "问题与权限请求" },
  "kpi.machines": { en: "Machines", it: "Macchine", "zh-TW": "機器", "zh-CN": "机器" },
  "kpi.machinesHint": { en: "online", it: "online", "zh-TW": "已連線", "zh-CN": "已连接" },
  "panel.recentTasks": { en: "Recent Tasks", it: "Task recenti", "zh-TW": "最近的任務", "zh-CN": "最近的任务" },
  "panel.recentTasksHint": {
    en: "Most recently active durable work.",
    it: "Il lavoro durevole più recente.",
    "zh-TW": "最近活動的持久工作。",
    "zh-CN": "最近活动的持久工作。"
  },
  "panel.needsYouHint": {
    en: "Agent questions and permission requests.",
    it: "Domande degli agenti e richieste di permesso.",
    "zh-TW": "代理的問題與權限請求。",
    "zh-CN": "代理的问题与权限请求。"
  },
  "panel.emptyRecentTasks": {
    en: "No Tasks on this machine yet.",
    it: "Nessun Task su questa macchina.",
    "zh-TW": "這台機器上還沒有任務。",
    "zh-CN": "这台机器上还没有任务。"
  },

  "tasks.eyebrow": { en: "Durable work", it: "Lavoro durevole", "zh-TW": "持久工作", "zh-CN": "持久工作" },
  "tasks.subtitle": {
    en: "One Task can contain multiple Runs and native Sessions.",
    it: "Un Task può contenere più Run e più Sessioni native.",
    "zh-TW": "一個任務可包含多個 Run 與多個原生工作階段。",
    "zh-CN": "一个任务可包含多个 Run 与多个原生会话。"
  },
  "tasks.emptyTitle": { en: "No Tasks match this view.", it: "Nessun Task corrisponde a questa vista.", "zh-TW": "沒有任務符合此檢視。", "zh-CN": "没有任务符合此视图。" },
  "tasks.emptyHint": {
    en: "Change filters or start a new Task.",
    it: "Cambia i filtri o avvia un nuovo Task.",
    "zh-TW": "調整篩選條件或建立新任務。",
    "zh-CN": "调整筛选条件或新建任务。"
  },
  "tasks.loading": { en: "Loading Tasks…", it: "Caricamento dei Task…", "zh-TW": "正在載入任務…", "zh-CN": "正在加载任务…" },
  "tasks.offlineTitle": { en: "No machine is reachable.", it: "Nessuna macchina raggiungibile.", "zh-TW": "無法連線到任何機器。", "zh-CN": "无法连接到任何机器。" },
  "tasks.offlineHint": {
    en: "Tasks stay on the machine that runs them, so nothing can be listed until one answers.",
    it: "I Task restano sulla macchina che li esegue, quindi non è possibile elencarli finché una non risponde.",
    "zh-TW": "任務儲存在執行它們的機器上，因此在有機器回應之前無法列出。",
    "zh-CN": "任务保存在执行它们的机器上，因此在有机器响应之前无法列出。"
  },

  "filter.all": { en: "All", it: "Tutti", "zh-TW": "全部", "zh-CN": "全部" },
  "filter.active": { en: "Working", it: "In lavorazione", "zh-TW": "進行中", "zh-CN": "进行中" },
  "filter.review": { en: "Review", it: "Revisione", "zh-TW": "審閱", "zh-CN": "审阅" },
  "filter.finished": { en: "Finished", it: "Conclusi", "zh-TW": "已完成", "zh-CN": "已完成" },
  "filter.failed": { en: "Failed", it: "Falliti", "zh-TW": "失敗", "zh-CN": "失败" },

  "column.task": { en: "Task", it: "Task", "zh-TW": "任務", "zh-CN": "任务" },
  "column.project": { en: "Project", it: "Progetto", "zh-TW": "專案", "zh-CN": "项目" },
  "column.agent": { en: "Agent", it: "Agente", "zh-TW": "代理", "zh-CN": "代理" },
  "column.model": { en: "Model", it: "Modello", "zh-TW": "模型", "zh-CN": "模型" },
  "column.workspace": { en: "Workspace", it: "Workspace", "zh-TW": "工作區", "zh-CN": "工作区" },
  "column.status": { en: "Status", it: "Stato", "zh-TW": "狀態", "zh-CN": "状态" },
  "column.activity": { en: "Activity", it: "Attività", "zh-TW": "活動", "zh-CN": "活动" },

  "state.active": { en: "Working", it: "In lavorazione", "zh-TW": "進行中", "zh-CN": "进行中" },
  "state.review": { en: "Ready for review", it: "Pronto per revisione", "zh-TW": "待審閱", "zh-CN": "待审阅" },
  "state.finished": { en: "Finished", it: "Concluso", "zh-TW": "已完成", "zh-CN": "已完成" },
  "state.failed": { en: "Failed", it: "Fallito", "zh-TW": "失敗", "zh-CN": "失败" },
  "state.cancelled": { en: "Cancelled", it: "Annullato", "zh-TW": "已取消", "zh-CN": "已取消" },
  "state.draft": { en: "Draft", it: "Bozza", "zh-TW": "草稿", "zh-CN": "草稿" },

  "workspace.worktree": { en: "Isolated worktree", it: "Worktree isolato", "zh-TW": "獨立 worktree", "zh-CN": "独立 worktree" },
  "workspace.project": { en: "Project directory", it: "Cartella del progetto", "zh-TW": "專案目錄", "zh-CN": "项目目录" },

  "detail.eyebrow": { en: "Task review", it: "Revisione Task", "zh-TW": "任務審閱", "zh-CN": "任务审阅" },
  "detail.close": { en: "Close Task detail", it: "Chiudi dettaglio Task", "zh-TW": "關閉任務詳細資料", "zh-CN": "关闭任务详情" },
  "detail.selectTitle": { en: "Select a Task", it: "Seleziona un Task", "zh-TW": "選擇一個任務", "zh-CN": "选择一个任务" },
  "detail.selectHint": {
    en: "Review, conversation, diff and Run history appear here.",
    it: "Qui appaiono revisione, conversazione, diff e cronologia dei Run.",
    "zh-TW": "審閱、對話、差異與 Run 歷史會顯示在這裡。",
    "zh-CN": "审阅、对话、差异与 Run 历史会显示在这里。"
  },
  "detail.loading": { en: "Loading Task…", it: "Caricamento del Task…", "zh-TW": "正在載入任務…", "zh-CN": "正在加载任务…" },
  "detail.machine": { en: "Machine", it: "Macchina", "zh-TW": "機器", "zh-CN": "机器" },
  "detail.run": { en: "Run", it: "Run", "zh-TW": "Run", "zh-CN": "Run" },
  "detail.session": { en: "Session", it: "Sessione", "zh-TW": "工作階段", "zh-CN": "会话" },
  "detail.branch": { en: "Branch", it: "Branch", "zh-TW": "分支", "zh-CN": "分支" },

  "value.notStarted": { en: "Not started", it: "Non avviato", "zh-TW": "尚未開始", "zh-CN": "尚未开始" },
  "value.none": { en: "None", it: "Nessuna", "zh-TW": "無", "zh-CN": "无" },
  "value.unknown": { en: "Unknown", it: "Sconosciuto", "zh-TW": "未知", "zh-CN": "未知" },
  "value.projectCheckout": { en: "Project checkout", it: "Checkout del progetto", "zh-TW": "專案簽出", "zh-CN": "项目签出" },
  "value.yes": { en: "Yes", it: "Sì", "zh-TW": "是", "zh-CN": "是" },
  "value.no": { en: "No", it: "No", "zh-TW": "否", "zh-CN": "否" },

  "tab.review": { en: "Review", it: "Revisione", "zh-TW": "審閱", "zh-CN": "审阅" },
  "tab.conversation": { en: "Conversation", it: "Conversazione", "zh-TW": "對話", "zh-CN": "对话" },
  "tab.diff": { en: "Diff", it: "Diff", "zh-TW": "差異", "zh-CN": "差异" },
  "tab.runs": { en: "Runs", it: "Run", "zh-TW": "Run", "zh-CN": "Run" },

  "review.eyebrow": { en: "Current outcome", it: "Risultato attuale", "zh-TW": "目前結果", "zh-CN": "当前结果" },
  "review.runComplete": {
    en: "Run complete. Review the result before finishing the Task.",
    it: "Run completato. Rivedi il risultato prima di concludere il Task.",
    "zh-TW": "Run 已完成。完成任務前請先審閱結果。",
    "zh-CN": "Run 已完成。完成任务前请先审阅结果。"
  },
  "review.finished": { en: "Task finished.", it: "Task concluso.", "zh-TW": "任務已完成。", "zh-CN": "任务已完成。" },
  "review.working": { en: "Agent is still working.", it: "L’agente è ancora al lavoro.", "zh-TW": "代理仍在執行中。", "zh-CN": "代理仍在执行中。" },
  "review.default": { en: "Review the latest Task state.", it: "Rivedi lo stato più recente del Task.", "zh-TW": "審閱任務的最新狀態。", "zh-CN": "审阅任务的最新状态。" },
  "review.files": { en: "Files", it: "File", "zh-TW": "檔案", "zh-CN": "文件" },
  "review.ahead": { en: "Ahead", it: "Avanti", "zh-TW": "領先", "zh-CN": "领先" },
  "review.dirty": { en: "Dirty", it: "Modificato", "zh-TW": "有變更", "zh-CN": "有更改" },

  "relationship.title": { en: "Task → Run → Session", it: "Task → Run → Sessione", "zh-TW": "任務 → Run → 工作階段", "zh-CN": "任务 → Run → 会话" },
  "relationship.taskHint": { en: "Durable work item", it: "Elemento di lavoro durevole", "zh-TW": "持久工作項目", "zh-CN": "持久工作项" },
  "relationship.noRun": { en: "No Run yet", it: "Nessun Run", "zh-TW": "尚無 Run", "zh-CN": "尚无 Run" },
  "relationship.runStarted": { en: "Started {when}", it: "Avviato {when}", "zh-TW": "開始於 {when}", "zh-CN": "开始于 {when}" },

  "card.resultSummary": { en: "Result Summary", it: "Riepilogo del risultato", "zh-TW": "結果摘要", "zh-CN": "结果摘要" },
  "card.noResult": {
    en: "No assistant result is available yet.",
    it: "Nessun risultato dell’assistente è ancora disponibile.",
    "zh-TW": "尚無助理產生的結果。",
    "zh-CN": "尚无助理产生的结果。"
  },
  "card.changedFiles": { en: "Changed files", it: "File modificati", "zh-TW": "已變更檔案", "zh-CN": "已更改文件" },
  "card.commitsAhead": { en: "Commits ahead", it: "Commit avanti", "zh-TW": "領先的 commit", "zh-CN": "领先的 commit" },
  "card.commitsBehind": { en: "Commits behind", it: "Commit indietro", "zh-TW": "落後的 commit", "zh-CN": "落后的 commit" },
  "card.mergedToSource": { en: "Merged to source", it: "Unito al ramo di origine", "zh-TW": "已合併回來源", "zh-CN": "已合并回来源" },
  "card.agentPlan": { en: "Agent plan", it: "Piano dell’agente", "zh-TW": "代理計畫", "zh-CN": "代理计划" },

  "conversation.empty": {
    en: "No conversation is available for this Run.",
    it: "Nessuna conversazione disponibile per questo Run.",
    "zh-TW": "此 Run 沒有可用的對話。",
    "zh-CN": "此 Run 没有可用的对话。"
  },
  "conversation.you": { en: "You", it: "Tu", "zh-TW": "你", "zh-CN": "你" },
  "conversation.agent": { en: "Agent", it: "Agente", "zh-TW": "代理", "zh-CN": "代理" },

  "diff.empty": {
    en: "No changed files were reported by the current Session.",
    it: "La Sessione corrente non ha segnalato file modificati.",
    "zh-TW": "目前的工作階段未回報任何變更檔案。",
    "zh-CN": "当前会话未报告任何更改文件。"
  },
  "diff.noPatch": { en: "No patch text available.", it: "Nessun testo di patch disponibile.", "zh-TW": "沒有可用的 patch 內容。", "zh-CN": "没有可用的 patch 内容。" },

  "runs.title": { en: "Run history", it: "Cronologia dei Run", "zh-TW": "Run 歷史", "zh-CN": "Run 历史" },
  "runs.hint": {
    en: "Each continuation creates a new native Session while the Task remains the durable unit.",
    it: "Ogni continuazione crea una nuova Sessione nativa, mentre il Task resta l’unità durevole.",
    "zh-TW": "每次繼續都會建立新的原生工作階段，而任務仍是持久單位。",
    "zh-CN": "每次继续都会创建新的原生会话，而任务仍是持久单位。"
  },
  "runs.empty": { en: "This Task has not started a Run yet.", it: "Questo Task non ha ancora avviato un Run.", "zh-TW": "此任務尚未開始任何 Run。", "zh-CN": "此任务尚未开始任何 Run。" },
  "runs.started": { en: "Started", it: "Avviato", "zh-TW": "開始", "zh-CN": "开始" },
  "runs.finished": { en: "Finished", it: "Concluso", "zh-TW": "結束", "zh-CN": "结束" },
  "runs.review": { en: "Review Run", it: "Rivedi Run", "zh-TW": "審閱 Run", "zh-CN": "审阅 Run" },
  "runs.archiveEyebrow": { en: "Task history", it: "Cronologia del Task", "zh-TW": "任務歷史", "zh-CN": "任务历史" },
  "runs.archiveTitle": { en: "Run #{sequence}", it: "Run #{sequence}", "zh-TW": "Run #{sequence}", "zh-CN": "Run #{sequence}" },
  "runs.archiveLoading": { en: "Loading Run history…", it: "Caricamento della cronologia del Run…", "zh-TW": "正在載入 Run 歷史…", "zh-CN": "正在加载 Run 历史…" },
  "runs.archiveClose": { en: "Close Run history", it: "Chiudi cronologia del Run", "zh-TW": "關閉 Run 歷史", "zh-CN": "关闭 Run 历史" },
  "runs.statusCompleted": { en: "Completed", it: "Completato", "zh-TW": "已完成", "zh-CN": "已完成" },
  "runs.statusRecorded": { en: "Recorded", it: "Registrato", "zh-TW": "已記錄", "zh-CN": "已记录" },
  "runs.agentUnavailable": {
    en: "The agent that produced this Run is not available on this machine right now.",
    it: "L’agente che ha prodotto questo Run non è disponibile su questa macchina in questo momento.",
    "zh-TW": "產生此 Run 的代理目前在這台機器上無法使用。",
    "zh-CN": "产生此 Run 的代理目前在这台机器上不可用。"
  },

  "newTask.eyebrow": { en: "Durable work", it: "Lavoro durevole", "zh-TW": "持久工作", "zh-CN": "持久工作" },
  "newTask.subtitle": {
    en: "Choose where the work lives, which harness owns it, and the model that will run it.",
    it: "Scegli dove vive il lavoro, quale harness lo possiede e il modello che lo eseguirà.",
    "zh-TW": "選擇工作存放位置、由哪個 harness 負責，以及執行它的模型。",
    "zh-CN": "选择工作存放位置、由哪个 harness 负责，以及执行它的模型。"
  },
  "newTask.promptPlaceholder": {
    en: "Describe the outcome you want the agent to deliver…",
    it: "Descrivi il risultato che vuoi ottenere dall’agente…",
    "zh-TW": "描述你希望代理交付的成果…",
    "zh-CN": "描述你希望代理交付的成果…"
  },
  "newTask.startTask": { en: "Start Task", it: "Avvia Task", "zh-TW": "開始任務", "zh-CN": "开始任务" },
  "newTask.startingTask": { en: "Starting Task…", it: "Avvio del Task…", "zh-TW": "正在開始任務…", "zh-CN": "正在开始任务…" },
  "newTask.noMachine": {
    en: "Connect a machine before starting a Task.",
    it: "Collega una macchina prima di avviare un Task.",
    "zh-TW": "開始任務前請先連線一台機器。",
    "zh-CN": "开始任务前请先连接一台机器。"
  },
  "newTask.noProject": {
    en: "This machine has no discovered projects yet.",
    it: "Questa macchina non ha ancora progetti individuati.",
    "zh-TW": "這台機器尚未發現任何專案。",
    "zh-CN": "这台机器尚未发现任何项目。"
  },
  "field.machine": { en: "Machine", it: "Macchina", "zh-TW": "機器", "zh-CN": "机器" },
  "field.project": { en: "Project", it: "Progetto", "zh-TW": "專案", "zh-CN": "项目" },
  "field.agent": { en: "Agent", it: "Agente", "zh-TW": "代理", "zh-CN": "代理" },
  "field.model": { en: "Model", it: "Modello", "zh-TW": "模型", "zh-CN": "模型" },
  "field.task": { en: "Task", it: "Task", "zh-TW": "任務", "zh-CN": "任务" },
  "model.loading": { en: "Loading models…", it: "Caricamento dei modelli…", "zh-TW": "正在載入模型…", "zh-CN": "正在加载模型…" },
  "model.agentDefault": { en: "Agent default", it: "Predefinito dell’agente", "zh-TW": "代理預設值", "zh-CN": "代理默认值" },
  "worktree.title": { en: "Use an isolated Git worktree", it: "Usa un worktree Git isolato", "zh-TW": "使用獨立的 Git worktree", "zh-CN": "使用独立的 Git worktree" },
  "worktree.recommended": {
    en: "Recommended. The Task gets its own branch and working directory.",
    it: "Consigliato. Il Task ottiene un proprio branch e una propria cartella di lavoro.",
    "zh-TW": "建議選項。任務會取得自己的分支與工作目錄。",
    "zh-CN": "推荐选项。任务会获得自己的分支与工作目录。"
  },
  "worktree.notGit": {
    en: "This project is not Git-backed, so it runs in the project directory.",
    it: "Questo progetto non è basato su Git, quindi viene eseguito nella cartella del progetto.",
    "zh-TW": "此專案未使用 Git，因此會在專案目錄中執行。",
    "zh-CN": "此项目未使用 Git，因此会在项目目录中执行。"
  },
  "worktree.warning": {
    en: "This Task will edit the selected project checkout directly.",
    it: "Questo Task modificherà direttamente il checkout del progetto selezionato.",
    "zh-TW": "此任務會直接修改所選專案的簽出內容。",
    "zh-CN": "此任务会直接修改所选项目的签出内容。"
  },

  "continue.eyebrow": { en: "New Run", it: "Nuovo Run", "zh-TW": "新的 Run", "zh-CN": "新的 Run" },
  "continue.title": { en: "Continue Task", it: "Continua Task", "zh-TW": "繼續任務", "zh-CN": "继续任务" },
  "continue.prompt": { en: "What should the next Run do?", it: "Cosa deve fare il prossimo Run?", "zh-TW": "下一個 Run 該做什麼？", "zh-CN": "下一个 Run 该做什么？" },
  "continue.placeholder": {
    en: "Continue from the current workspace state and…",
    it: "Continua dallo stato attuale del workspace e…",
    "zh-TW": "從目前的工作區狀態繼續，並…",
    "zh-CN": "从当前工作区状态继续，并…"
  },
  "continue.start": { en: "Start new Run", it: "Avvia nuovo Run", "zh-TW": "開始新的 Run", "zh-CN": "开始新的 Run" },
  "continue.starting": { en: "Starting…", it: "Avvio…", "zh-TW": "正在開始…", "zh-CN": "正在开始…" },

  "cleanup.confirm": {
    en: "Release this Task's isolated worktree? Uncommitted changes are protected and will make the daemon refuse cleanup.",
    it: "Rilasciare il worktree isolato di questo Task? Le modifiche non committate sono protette e faranno rifiutare la pulizia al daemon.",
    "zh-TW": "要釋放此任務的獨立 worktree 嗎？未提交的變更受到保護，常駐服務會拒絕清理。",
    "zh-CN": "要释放此任务的独立 worktree 吗？未提交的更改受到保护，守护进程会拒绝清理。"
  },

  "needs.eyebrow": { en: "Attention inbox", it: "Posta in arrivo", "zh-TW": "待處理收件匣", "zh-CN": "待处理收件箱" },
  "needs.title": { en: "Needs You", it: "Richiede te", "zh-TW": "需要你", "zh-CN": "需要你" },
  "needs.subtitle": {
    en: "Questions and permission requests from native harness Sessions.",
    it: "Domande e richieste di permesso dalle Sessioni native degli harness.",
    "zh-TW": "來自原生 harness 工作階段的問題與權限請求。",
    "zh-CN": "来自原生 harness 会话的问题与权限请求。"
  },
  "needs.emptyTitle": { en: "Nothing needs you right now.", it: "Non c’è nulla che richieda la tua attenzione.", "zh-TW": "目前沒有需要你處理的事項。", "zh-CN": "目前没有需要你处理的事项。" },
  "needs.emptyMini": { en: "Nothing needs your attention.", it: "Nulla richiede la tua attenzione.", "zh-TW": "沒有需要你注意的事項。", "zh-CN": "没有需要你注意的事项。" },
  "needs.permission": { en: "Permission request", it: "Richiesta di permesso", "zh-TW": "權限請求", "zh-CN": "权限请求" },
  "needs.outsideScope": {
    en: "{count} more on other machines",
    it: "Altri {count} su altre macchine",
    "zh-TW": "其他機器上還有 {count} 項",
    "zh-CN": "其他机器上还有 {count} 项"
  },
  "needs.showAllMachines": { en: "Show all machines", it: "Mostra tutte le macchine", "zh-TW": "顯示所有機器", "zh-CN": "显示所有机器" },
  "needs.question": { en: "Question", it: "Domanda", "zh-TW": "問題", "zh-CN": "问题" },

  "projects.eyebrow": { en: "Machine catalog", it: "Catalogo della macchina", "zh-TW": "機器目錄", "zh-CN": "机器目录" },
  "projects.subtitle": {
    en: "Projects are daemon-known roots used by Tasks. Ordinary Sessions can still use their native directories.",
    it: "I progetti sono radici note al daemon e usate dai Task. Le Sessioni ordinarie possono comunque usare le loro cartelle native.",
    "zh-TW": "專案是常駐服務已知的根目錄，供任務使用。一般工作階段仍可使用其原生目錄。",
    "zh-CN": "项目是守护进程已知的根目录，供任务使用。普通会话仍可使用其原生目录。"
  },
  "projects.empty": {
    en: "No projects were discovered on the machines in scope.",
    it: "Nessun progetto individuato sulle macchine nell’ambito selezionato.",
    "zh-TW": "在所選範圍的機器上未發現任何專案。",
    "zh-CN": "在所选范围的机器上未发现任何项目。"
  },

  "agents.eyebrow": { en: "Harnesses", it: "Harness", "zh-TW": "Harness", "zh-CN": "Harness" },
  "agents.subtitle": {
    en: "Native coding harnesses discovered behind each machine daemon.",
    it: "Harness di coding nativi individuati dietro ogni daemon macchina.",
    "zh-TW": "在每個機器常駐服務後方發現的原生編碼 harness。",
    "zh-CN": "在每个机器守护进程后方发现的原生编码 harness。"
  },
  "agents.empty": {
    en: "No harness was discovered on the machines in scope.",
    it: "Nessun harness individuato sulle macchine nell’ambito selezionato.",
    "zh-TW": "在所選範圍的機器上未發現任何 harness。",
    "zh-CN": "在所选范围的机器上未发现任何 harness。"
  },

  "machines.eyebrow": { en: "Fleet", it: "Flotta", "zh-TW": "機群", "zh-CN": "机群" },
  "machines.subtitle": {
    en: "Execution, credentials and source code stay local to each configured machine.",
    it: "Esecuzione, credenziali e codice sorgente restano locali a ogni macchina configurata.",
    "zh-TW": "執行、憑證與原始碼都保留在各自設定的機器上。",
    "zh-CN": "执行、凭证与源代码都保留在各自配置的机器上。"
  },
  "machines.counts": {
    en: "{agents} agents · {tasks} Tasks",
    it: "{agents} agenti · {tasks} Task",
    "zh-TW": "{agents} 個代理 · {tasks} 個任務",
    "zh-CN": "{agents} 个代理 · {tasks} 个任务"
  },
  "machines.empty": {
    en: "No machine is configured yet.",
    it: "Nessuna macchina configurata.",
    "zh-TW": "尚未設定任何機器。",
    "zh-CN": "尚未配置任何机器。"
  },

  "classic.eyebrow": { en: "Legacy surface", it: "Superficie legacy", "zh-TW": "舊版介面", "zh-CN": "旧版界面" },
  "classic.hint": {
    en: "Kept intact during TaskDesk validation.",
    it: "Mantenuta intatta durante la validazione di TaskDesk.",
    "zh-TW": "在 TaskDesk 驗證期間保持原樣。",
    "zh-CN": "在 TaskDesk 验证期间保持原样。"
  },

  "sessions.viewHint": {
    en: "Native harness conversations",
    it: "Conversazioni native degli harness",
    "zh-TW": "原生 harness 對話",
    "zh-CN": "原生 harness 对话"
  },

  "settings.eyebrow": { en: "Preferences", it: "Preferenze", "zh-TW": "偏好設定", "zh-CN": "偏好设置" },
  "settings.title": { en: "Settings", it: "Impostazioni", "zh-TW": "設定", "zh-CN": "设置" },
  "settings.subtitle": {
    en: "Appearance and language apply to TaskDesk and to Classic 2.x.",
    it: "Aspetto e lingua si applicano a TaskDesk e alla versione Classica 2.x.",
    "zh-TW": "外觀與語言同時套用於 TaskDesk 與經典 2.x。",
    "zh-CN": "外观与语言同时应用于 TaskDesk 与经典 2.x。"
  },
  "settings.appearance": { en: "Appearance", it: "Aspetto", "zh-TW": "外觀", "zh-CN": "外观" },
  "settings.theme": { en: "Theme", it: "Tema", "zh-TW": "主題", "zh-CN": "主题" },
  "settings.themeSystem": { en: "As device", it: "Come il dispositivo", "zh-TW": "跟隨系統", "zh-CN": "跟随系统" },
  "settings.themeLight": { en: "Light", it: "Chiaro", "zh-TW": "淺色", "zh-CN": "浅色" },
  "settings.themeDark": { en: "Dark", it: "Scuro", "zh-TW": "深色", "zh-CN": "深色" },
  "settings.themeHint": {
    en: "As device follows the operating system setting.",
    it: "«Come il dispositivo» segue l’impostazione del sistema operativo.",
    "zh-TW": "「跟隨系統」會依照作業系統的設定。",
    "zh-CN": "“跟随系统”会依照操作系统的设置。"
  },
  "settings.language": { en: "Language", it: "Lingua", "zh-TW": "語言", "zh-CN": "语言" },
  "settings.languageHint": {
    en: "Task and Run keep their product names in every language.",
    it: "Task e Run mantengono i loro nomi di prodotto in ogni lingua.",
    "zh-TW": "Task 與 Run 在所有語言中都保留其產品名稱。",
    "zh-CN": "Task 与 Run 在所有语言中都保留其产品名称。"
  },
  "settings.done": { en: "Done", it: "Fatto", "zh-TW": "完成", "zh-CN": "完成" },

  "time.now": { en: "now", it: "ora", "zh-TW": "剛剛", "zh-CN": "刚刚" },
  "time.minutes": { en: "{value}m ago", it: "{value} min fa", "zh-TW": "{value} 分鐘前", "zh-CN": "{value} 分钟前" },
  "time.hours": { en: "{value}h ago", it: "{value} h fa", "zh-TW": "{value} 小時前", "zh-CN": "{value} 小时前" },
  "time.days": { en: "{value}d ago", it: "{value} g fa", "zh-TW": "{value} 天前", "zh-CN": "{value} 天前" }
} satisfies Record<string, Entry>

export type TaskDeskTranslationKey = keyof typeof dictionary
export type TaskDeskTranslator = (key: TaskDeskTranslationKey, params?: Record<string, string | number>) => string

export const taskDeskDictionary: Record<string, Entry> = dictionary

export function createTaskDeskTranslator(language: LanguageCode): TaskDeskTranslator {
  return (key, params = {}) => {
    const entry = dictionary[key]
    const template = entry ? entry[language] || entry.en : String(key)
    return Object.entries(params).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
      template
    )
  }
}

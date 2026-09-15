const {
  ItemView,
  Modal,
  Notice,
  Plugin,
  Setting,
  TFile,
  setIcon,
} = require("obsidian");

const VIEW_TYPE = "second-brain-core-view";

function value(frontmatter, key, fallback = "") {
  const current = frontmatter ? frontmatter[key] : undefined;
  if (current === undefined || current === null) return fallback;
  return current;
}

function asString(input) {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input.replace(/^\[\[|\]\]$/g, "");
  if (typeof input === "object" && input.path) return String(input.path);
  return String(input);
}

function asArray(input) {
  if (Array.isArray(input)) return input.map(asString).filter(Boolean);
  if (!input) return [];
  return String(input).split(",").map((part) => part.trim()).filter(Boolean);
}

function safeNumber(input, fallback = 0) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function yamlQuote(input) {
  return JSON.stringify(String(input ?? ""));
}

function isCompleted(record) {
  const status = asString(record?.status).toLocaleLowerCase("ru");
  return record?.progress >= 100 || ["done", "completed", "complete", "выполнено", "готово"].includes(status);
}

function dateKey(input) {
  const text = asString(input);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function formatDate(input) {
  const key = dateKey(input);
  if (!key) return "Без даты";
  const date = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function asDeadlineStages(input) {
  const items = Array.isArray(input) ? input : [];
  return items.map((item, index) => {
    if (typeof item === "string") {
      return { title: "", due: dateKey(item), time: "", anchor: "", showFrom: "", index };
    }
    if (!item || typeof item !== "object") return null;
    return {
      title: asString(item.title || item.name || ""),
      due: dateKey(item.date || item.due || ""),
      time: asString(item.time || ""),
      anchor: asString(item.anchor || item["anchor-id"] || item.event || item.class || ""),
      showFrom: dateKey(item["show-from"] || item.showFrom || item["hidden-until"] || ""),
      index,
    };
  }).filter((item) => item && (item.due || item.anchor));
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "task";
}

function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class BrainIndex {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.records = [];
    this.byId = new Map();
    this.tasks = [];
    this.deadlines = [];
    this.events = [];
    this.classes = [];
    this.nodes = [];
    this.children = new Map();
  }

  async rebuild() {
    const records = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const roots = this.settings.contentRoots || [];
      if (roots.length && !roots.some((root) => file.path === root || file.path.startsWith(`${root}/`))) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || !value(fm, "sb-type")) continue;
      if (value(fm, "sb-template", false) === true) continue;
      const type = asString(value(fm, "sb-type"));
      const id = asString(value(fm, "sb-id", file.path.replace(/\.md$/i, "")));
      records.push({
        file,
        path: file.path,
        title: asString(value(fm, "title", file.basename)),
        type,
        id,
        parent: asString(value(fm, "sb-parent")),
        subject: asString(value(fm, "sb-subject")),
        quantum: asString(value(fm, "sb-quant", value(fm, "sb-parent"))),
        date: dateKey(value(fm, "date")),
        due: dateKey(value(fm, "due")),
        time: asString(value(fm, "time")),
        endTime: asString(value(fm, "end-time")),
        weekday: safeNumber(value(fm, "weekday"), 0),
        weekParity: asString(value(fm, "week-parity", "all")).toLowerCase(),
        campus: asString(value(fm, "campus", "")),
        status: asString(value(fm, "status", "active")),
        progress: Math.max(0, Math.min(100, safeNumber(value(fm, "progress"), 0))),
        eventKind: asString(value(fm, "event-kind", "event")),
        deadlineTitle: asString(value(fm, "deadline-title", "")),
        deadlineQuantum: asString(value(fm, "deadline-quant", "")),
        deadlinePath: asString(value(fm, "deadline-path", "")),
        deadlineTime: asString(value(fm, "deadline-time", "")),
        deadlineAnchor: asString(value(fm, "deadline-anchor", "")),
        deadlineStages: asDeadlineStages(value(fm, "deadlines", [])),
        showFrom: dateKey(value(fm, "show-from", value(fm, "hidden-until", ""))),
        graph: value(fm, "graph", true) !== false,
        summary: asString(value(fm, "summary", "")),
        teacher: asString(value(fm, "teacher", "")),
        room: asString(value(fm, "room", "")),
        nextAction: asString(value(fm, "next-action", "")),
        weeklyGoal: asString(value(fm, "weekly-goal", "")),
        weeklyResult: asString(value(fm, "weekly-result", "pending")),
        weeklyGoalDate: dateKey(value(fm, "weekly-goal-date", "")),
        progressStep: Math.max(1, safeNumber(value(fm, "progress-step", 10), 10)),
        tags: asArray(value(fm, "tags", [])),
        links: asArray(value(fm, "sb-links", [])),
      });
    }

    this.records = records;
    this.byId = new Map(records.filter((record) => record.id).map((record) => [record.id, record]));
    this.tasks = records.filter((record) => record.type === "task").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    this.deadlines = records.filter((record) => record.type === "deadline").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    this.events = records.filter((record) => record.type === "event").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    this.classes = records.filter((record) => record.type === "class").sort((a, b) => `${a.weekday}${a.time}`.localeCompare(`${b.weekday}${b.time}`));
    this.nodes = records.filter((record) => record.id && record.graph && !["event", "class", "deadline"].includes(record.type));
    this.children = new Map();
    for (const node of this.nodes) {
      if (!node.parent) continue;
      if (!this.children.has(node.parent)) this.children.set(node.parent, []);
      this.children.get(node.parent).push(node.id);
    }
  }

  descendants(id) {
    const result = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const current = queue.shift();
      for (const child of this.children.get(current) || []) {
        if (result.has(child)) continue;
        result.add(child);
        queue.push(child);
      }
    }
    return result;
  }

  ancestors(id) {
    const result = new Set();
    let current = this.byId.get(id);
    let guard = 0;
    while (current?.parent && guard < 100) {
      result.add(current.parent);
      current = this.byId.get(current.parent);
      guard += 1;
    }
    return result;
  }

  scope(id) {
    const result = this.descendants(id);
    for (const parent of this.ancestors(id)) result.add(parent);
    return result;
  }

  subjectFor(recordOrId) {
    let record = typeof recordOrId === "string" ? this.byId.get(recordOrId) : recordOrId;
    if (!record) return null;
    if (record.type === "subject") return record;
    if (record.subject && this.byId.has(record.subject)) return this.byId.get(record.subject);
    let guard = 0;
    while (record?.parent && guard < 100) {
      record = this.byId.get(record.parent);
      if (record?.type === "subject") return record;
      guard += 1;
    }
    return null;
  }

  tasksForQuantum(id) {
    const descendants = this.descendants(id);
    const subject = this.subjectFor(id);
    return this.tasks.filter((task) => {
      if (descendants.has(task.id) || descendants.has(task.parent) || descendants.has(task.quantum)) return true;
      return subject && task.subject === subject.id;
    });
  }

  isVisible(record, today = localDateKey(new Date())) {
    return !record?.showFrom || record.showFrom <= today;
  }

  weekInfo(date) {
    const semesterStart = new Date(`${this.settings.semesterStart || "2026-08-31"}T12:00:00`);
    const current = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const days = Math.floor((current - semesterStart) / 86400000);
    const number = Math.floor(days / 7) + 1;
    return {
      number,
      parity: Math.abs(number) % 2 === 0 ? "even" : "odd",
      label: Math.abs(number) % 2 === 0 ? "знаменатель" : "числитель",
    };
  }

  classesForDate(date) {
    const weekday = date.getDay() === 0 ? 7 : date.getDay();
    const week = this.weekInfo(date);
    return this.classes.filter((record) => {
      if (record.weekday !== weekday) return false;
      return record.weekParity === "all" || record.weekParity === week.parity;
    });
  }

  recurringDeadlinesForDate(date) {
    const key = localDateKey(date);
    return this.classesForDate(date)
      .filter((record) => record.deadlineTitle)
      .map((record) => {
        const projectId = record.deadlineQuantum || record.quantum || record.parent;
        const project = this.byId.get(projectId);
        return {
          ...record,
          id: `${record.id}-deadline-${key}`,
          path: project?.path || record.deadlinePath || record.path,
          title: project?.title || record.deadlineTitle,
          type: "task",
          date: key,
          due: key,
          time: record.deadlineTime || record.time,
          quantum: projectId,
          parent: projectId,
          status: project?.status || "project-deadline",
          progress: project?.progress || 0,
          summary: project?.summary || `Повторяющийся дедлайн проекта к семинару «${record.title}».`,
          nextAction: project?.nextAction || "Дополнить описание проекта",
          sourceClassId: record.id,
          sourceClassTitle: record.title,
          sourceAnchorId: record.id,
          sourceAnchorTitle: record.title,
          originId: project?.id || record.id,
          deadlineGroupId: projectId || record.id,
          showFrom: project?.showFrom || record.showFrom || "",
        };
      })
      .filter((record) => this.isVisible(record));
  }

  deadlineOccurrences(record) {
    const stages = record.deadlineStages.length
      ? record.deadlineStages
      : [{ title: "", due: record.due, time: record.time, anchor: record.deadlineAnchor, showFrom: "", index: 0 }];
    return stages.map((stage, index) => {
      const anchorId = stage.anchor || record.deadlineAnchor;
      const anchor = this.byId.get(anchorId);
      const due = stage.due || record.due || anchor?.date || "";
      const showFrom = stage.showFrom || record.showFrom || "";
      return {
        ...record,
        id: `${record.id}-deadline-stage-${index}`,
        type: "task",
        title: stage.title ? `${record.title} · ${stage.title}` : record.title,
        stageTitle: stage.title,
        date: due,
        due,
        time: stage.time || record.time || anchor?.time || "",
        sourceAnchorId: anchorId,
        sourceAnchorTitle: anchor?.title || "",
        sourceClassId: anchor?.type === "class" ? anchor.id : "",
        sourceClassTitle: anchor?.type === "class" ? anchor.title : "",
        originId: record.id,
        deadlineGroupId: record.id,
        showFrom,
        isManualDeadline: true,
      };
    }).filter((stage) => stage.due || stage.sourceAnchorId);
  }

  manualDeadlineOccurrences(includeHidden = false) {
    return this.deadlines.flatMap((record) => this.deadlineOccurrences(record))
      .filter((record) => includeHidden || this.isVisible(record));
  }

  deadlinesForDate(date) {
    const key = localDateKey(date);
    const manual = this.manualDeadlineOccurrences().filter((record) => record.due === key);
    return [...this.recurringDeadlinesForDate(date), ...manual];
  }

  upcomingDeadlinesForQuantum(id, limit = 6) {
    const scope = this.descendants(id);
    const subject = this.subjectFor(id);
    const result = [];
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    for (let offset = 0; offset < 140 && result.length < limit; offset += 1) {
      const current = new Date(date);
      current.setDate(date.getDate() + offset);
      for (const deadline of this.recurringDeadlinesForDate(current)) {
        if (scope.has(deadline.quantum) || scope.has(deadline.parent) || (subject && deadline.subject === subject.id)) result.push(deadline);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  allUpcomingRecurringDeadlines(limit = 18) {
    const result = [];
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    for (let offset = 0; offset < 210 && result.length < limit; offset += 1) {
      const current = new Date(date);
      current.setDate(date.getDate() + offset);
      result.push(...this.recurringDeadlinesForDate(current));
    }
    return result.slice(0, limit);
  }

  deadlineAnchors() {
    const anchors = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    for (let offset = -14; offset <= 210; offset += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      const key = localDateKey(date);
      for (const record of this.classesForDate(date)) {
        anchors.push({
          key: `${record.id}@@${key}`,
          id: record.id,
          date: key,
          time: record.time,
          title: record.title,
          type: record.type,
          label: `${formatDate(key)} · ${record.time || "—"} · ${record.title}`,
        });
      }
    }
    for (const record of this.events) {
      if (!record.date) continue;
      anchors.push({
        key: `${record.id}@@${record.date}`,
        id: record.id,
        date: record.date,
        time: record.time,
        title: record.title,
        type: record.type,
        label: `${formatDate(record.date)} · ${record.time || "—"} · ${record.title}`,
      });
    }
    return anchors.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }
}

class NewTaskModal extends Modal {
  constructor(app, plugin, initialQuantum = "") {
    super(app);
    this.plugin = plugin;
    this.data = {
      title: "",
      due: new Date().toISOString().slice(0, 10),
      quantum: initialQuantum || plugin.index.nodes.find((node) => node.type === "subject")?.id || "second-brain",
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("sb-task-modal");
    contentEl.createEl("h2", { text: "Новое задание" });
    new Setting(contentEl)
      .setName("Название")
      .addText((text) => text.setPlaceholder("Что нужно сделать?").onChange((next) => { this.data.title = next; }));
    new Setting(contentEl)
      .setName("Дедлайн")
      .addText((text) => text.setPlaceholder("YYYY-MM-DD").setValue(this.data.due).onChange((next) => { this.data.due = next; }));
    const quantumOptions = this.plugin.index.nodes.filter((node) => ["subject", "quantum"].includes(node.type));
    new Setting(contentEl)
      .setName("Квант")
      .addDropdown((dropdown) => {
        for (const node of quantumOptions) dropdown.addOption(node.id, node.title);
        dropdown.setValue(this.data.quantum).onChange((next) => { this.data.quantum = next; });
      });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Создать").setCta().onClick(async () => {
        if (!this.data.title.trim()) {
          new Notice("Введите название задания");
          return;
        }
        await this.plugin.createTask(this.data);
        this.close();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class NewDeadlineModal extends Modal {
  constructor(app, plugin, initialQuantum = "") {
    super(app);
    this.plugin = plugin;
    this.data = {
      title: "",
      quantum: initialQuantum || plugin.index.nodes.find((node) => node.type === "subject")?.id || "second-brain",
      showFrom: "",
      stages: [{ title: "", due: localDateKey(new Date()), time: "", anchor: "", anchorKey: "" }],
    };
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("sb-deadline-modal-shell");
    contentEl.addClass("sb-task-modal");
    contentEl.addClass("sb-deadline-modal");
    contentEl.createEl("h2", { text: "Новый дедлайн" });
    contentEl.createEl("p", {
      cls: "sb-modal-intro",
      text: "Один файл может содержать несколько сроков. Каждый срок можно связать с конкретной парой или событием.",
    });

    new Setting(contentEl)
      .setName("Название")
      .addText((text) => text.setPlaceholder("Например: Курсовой проект").onChange((next) => { this.data.title = next; }));

    const quantumOptions = this.plugin.index.nodes.filter((node) => ["subject", "quantum"].includes(node.type));
    if (!quantumOptions.some((node) => node.id === this.data.quantum) && quantumOptions[0]) this.data.quantum = quantumOptions[0].id;
    new Setting(contentEl)
      .setName("Тема")
      .setDesc("Предмет, проект или точный квант, к которому относится дедлайн")
      .addDropdown((dropdown) => {
        for (const node of quantumOptions) {
          const subject = this.plugin.index.subjectFor(node);
          const label = node.type === "subject" || !subject || subject.id === node.id ? node.title : `${subject.title} → ${node.title}`;
          dropdown.addOption(node.id, label);
        }
        dropdown.setValue(this.data.quantum).onChange((next) => { this.data.quantum = next; });
      });

    new Setting(contentEl)
      .setName("Показывать с")
      .setDesc("Оставьте пустым, чтобы дедлайн отображался постоянно")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.data.showFrom).onChange((next) => { this.data.showFrom = dateKey(next); });
      });

    contentEl.createEl("h3", { cls: "sb-modal-subtitle", text: "Сроки и этапы" });
    const stageHost = contentEl.createDiv({ cls: "sb-deadline-stage-list" });
    const anchors = this.plugin.index.deadlineAnchors();
    const anchorMap = new Map(anchors.map((anchor) => [anchor.key, anchor]));

    const renderStages = () => {
      stageHost.empty();
      this.data.stages.forEach((stage, index) => {
        const card = stageHost.createDiv({ cls: "sb-deadline-stage-editor" });
        const head = card.createDiv({ cls: "sb-deadline-stage-head" });
        head.createEl("strong", { text: `Этап ${index + 1}` });
        const remove = head.createEl("button", { cls: "sb-icon-button", attr: { "aria-label": "Удалить этап" } });
        setIcon(remove, "trash-2");
        remove.disabled = this.data.stages.length === 1;
        remove.addEventListener("click", () => {
          if (this.data.stages.length === 1) return;
          this.data.stages.splice(index, 1);
          renderStages();
        });

        const label = card.createEl("input", {
          cls: "sb-modal-input",
          attr: { type: "text", placeholder: "Название этапа — необязательно" },
        });
        label.value = stage.title;
        label.addEventListener("input", () => { stage.title = label.value; });

        const fields = card.createDiv({ cls: "sb-deadline-stage-fields" });
        const dateInput = fields.createEl("input", { cls: "sb-modal-input", attr: { type: "date", "aria-label": "Дата этапа" } });
        dateInput.value = stage.due;
        dateInput.addEventListener("input", () => { stage.due = dateKey(dateInput.value); });

        const anchorSelect = fields.createEl("select", { cls: "dropdown sb-deadline-anchor-select", attr: { "aria-label": "Привязка к паре или событию" } });
        anchorSelect.createEl("option", { value: "", text: "Только дата — без события" });
        for (const anchor of anchors) anchorSelect.createEl("option", { value: anchor.key, text: anchor.label });
        anchorSelect.value = stage.anchorKey || "";
        anchorSelect.addEventListener("change", () => {
          const anchor = anchorMap.get(anchorSelect.value);
          stage.anchorKey = anchor?.key || "";
          stage.anchor = anchor?.id || "";
          if (anchor) {
            stage.due = anchor.date;
            stage.time = anchor.time || "";
          }
          renderStages();
        });
      });
    };
    renderStages();

    const addStage = contentEl.createEl("button", { cls: "sb-small-button sb-add-stage", text: "Добавить ещё срок" });
    setIcon(addStage.createSpan(), "plus");
    addStage.addEventListener("click", () => {
      const previous = this.data.stages[this.data.stages.length - 1];
      this.data.stages.push({ title: "", due: previous?.due || localDateKey(new Date()), time: "", anchor: "", anchorKey: "" });
      renderStages();
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Создать дедлайн").setCta().onClick(async () => {
        if (!this.data.title.trim()) {
          new Notice("Введите название дедлайна");
          return;
        }
        if (!this.data.stages.length || this.data.stages.some((stage) => !dateKey(stage.due))) {
          new Notice("Укажите дату для каждого этапа");
          return;
        }
        await this.plugin.createDeadline(this.data);
        this.close();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DeadlineVisibilityModal extends Modal {
  constructor(app, plugin, record) {
    super(app);
    this.plugin = plugin;
    this.record = record;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.showFrom = record.showFrom && record.showFrom > localDateKey(new Date()) ? record.showFrom : localDateKey(tomorrow);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("sb-task-modal");
    contentEl.createEl("h2", { text: "Видимость дедлайна" });
    contentEl.createEl("p", { cls: "sb-modal-intro", text: this.record.title });
    new Setting(contentEl)
      .setName("Скрыть до даты")
      .setDesc("В указанную дату карточка снова появится автоматически")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.showFrom).onChange((next) => { this.showFrom = dateKey(next); });
      });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Показывать всегда").onClick(async () => {
        await this.plugin.setDeadlineShowFrom(this.record, "");
        this.close();
      }))
      .addButton((button) => button.setButtonText("Скрыть").setCta().onClick(async () => {
        if (!this.showFrom) {
          new Notice("Выберите дату возврата");
          return;
        }
        await this.plugin.setDeadlineShowFrom(this.record, this.showFrom);
        this.close();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class AddItemModal extends Modal {
  constructor(app, plugin, initialQuantum = "") {
    super(app);
    this.plugin = plugin;
    this.initialQuantum = initialQuantum;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("sb-create-menu-modal");
    const head = contentEl.createDiv({ cls: "sb-create-menu-head" });
    head.createEl("h2", { text: "Что добавить?" });
    head.createEl("p", { text: "Выбери тип — дальше откроется короткая понятная форма." });
    const grid = contentEl.createDiv({ cls: "sb-create-choice-grid" });

    const addChoice = (iconName, title, description, meta, action, primary = false) => {
      const button = grid.createEl("button", { cls: `sb-create-choice ${primary ? "is-primary" : ""}` });
      const icon = button.createSpan({ cls: "sb-create-choice-icon" });
      setIcon(icon, iconName);
      const copy = button.createSpan({ cls: "sb-create-choice-copy" });
      copy.createSpan({ cls: "sb-create-choice-title", text: title });
      copy.createSpan({ cls: "sb-create-choice-description", text: description });
      copy.createSpan({ cls: "sb-create-choice-meta", text: meta });
      const arrow = button.createSpan({ cls: "sb-create-choice-arrow" });
      setIcon(arrow, "arrow-right");
      button.addEventListener("click", () => {
        this.close();
        window.setTimeout(action, 0);
      });
    };

    addChoice(
      "circle-check-big",
      "Задачу",
      "Обычное дело с одной датой и прогрессом.",
      "Название · дата · тема",
      () => new NewTaskModal(this.app, this.plugin, this.initialQuantum).open(),
    );
    addChoice(
      "flag",
      "Дедлайн",
      "Один или несколько сроков в общей карточке.",
      "Этапы · пара или событие · скрыть до даты",
      () => new NewDeadlineModal(this.app, this.plugin, this.initialQuantum).open(),
      true,
    );

    contentEl.createDiv({ cls: "sb-create-menu-hint", text: "Esc — закрыть без добавления" });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DeleteRecordModal extends Modal {
  constructor(app, plugin, record) {
    super(app);
    this.plugin = plugin;
    this.record = record;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("sb-delete-modal");
    const icon = contentEl.createDiv({ cls: "sb-delete-modal-icon" });
    setIcon(icon, "trash-2");
    contentEl.createEl("h2", { text: "Удалить выполненное?" });
    contentEl.createEl("p", {
      text: `«${this.record.title}» будет перемещено в системную корзину. При необходимости файл можно восстановить.`,
    });
    const actions = contentEl.createDiv({ cls: "sb-delete-modal-actions" });
    const cancel = actions.createEl("button", { text: "Оставить" });
    cancel.addEventListener("click", () => this.close());
    const remove = actions.createEl("button", { cls: "mod-warning", text: "Удалить" });
    remove.addEventListener("click", async () => {
      await this.plugin.deleteRecord(this.record);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class SecondBrainView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activePage = plugin.settings.defaultView || "calendar";
    this.currentDate = new Date();
    this.selectedQuantum = plugin.settings.lastSelectedQuantum || "second-brain";
    this.selectedTaskId = "";
    this.contextPinned = false;
    this.graphExpanded = false;
    this.calendarExpanded = false;
    this.hideContextTimer = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Second Brain"; }
  getIcon() { return "calendar-range"; }

  async onOpen() {
    await this.plugin.index.rebuild();
    const remembered = this.plugin.index.byId.get(this.plugin.settings.lastSelectedQuantum);
    const preferred = remembered || this.plugin.index.nodes.find((node) => node.type === "subject") || this.plugin.index.nodes[0];
    if (preferred) this.selectedQuantum = preferred.id;
    if (remembered) this.persistentHighlight = remembered.id;
    this.render();
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape" && this.graphExpanded) {
        this.toggleGraphExpanded(false);
      }
    });
    this.registerDomEvent(window, "resize", () => this.scheduleResponsiveRefresh());
  }

  async onClose() {
    this.resizeObserver?.disconnect();
    window.clearTimeout(this.responsiveTimer);
    if (this.graphAnimationFrame) window.cancelAnimationFrame(this.graphAnimationFrame);
    this.graphTransitionAnimation?.cancel();
    this.calendarTransitionAnimation?.cancel();
  }

  async refresh() {
    await this.plugin.index.rebuild();
    if (!this.plugin.index.byId.has(this.selectedQuantum)) {
      this.selectedQuantum = this.plugin.index.nodes.find((node) => node.type === "subject")?.id || "second-brain";
    }
    this.render();
  }

  render() {
    this.resizeObserver?.disconnect();
    this.contentEl.empty();
    this.contentEl.addClass("sb-core-host");
    this.rootEl = this.contentEl.createDiv({ cls: "sb-core" });
    this.renderToolbar();
    this.stageEl = this.rootEl.createDiv({ cls: "sb-stage" });
    this.mainEl = this.stageEl.createDiv({ cls: "sb-main-space" });
    this.contextSlotEl = this.stageEl.createDiv({ cls: "sb-context-slot" });
    this.contextSlotEl.createDiv({ cls: "sb-context-placeholder", text: "Наведите на событие, задание или квант" });
    this.contextCardEl = this.contextSlotEl.createDiv({ cls: "sb-context-card" });
    this.contextCardEl.addEventListener("mouseenter", () => window.clearTimeout(this.hideContextTimer));
    this.contextCardEl.addEventListener("mouseleave", () => this.hideContext());
    this.graphHostEl = this.rootEl.createDiv({ cls: "sb-graph-host" });
    this.updateResponsiveProfile();
    this.renderPage();
    this.renderGraph();
    this.observeResponsiveLayout();
  }

  responsiveProfile(width, height) {
    if (width >= 1450 && height >= 820) return "large";
    if (width >= 1000 && height >= 650) return "medium";
    return "compact";
  }

  updateResponsiveProfile(width = this.rootEl?.clientWidth || 0, height = this.rootEl?.clientHeight || 0) {
    if (!this.rootEl) return false;
    const profile = this.responsiveProfile(width, height);
    const changed = this.rootEl.dataset.layout !== profile;
    this.rootEl.dataset.layout = profile;
    this.rootEl.style.setProperty("--sb-available-width", `${Math.round(width)}px`);
    this.rootEl.style.setProperty("--sb-available-height", `${Math.round(height)}px`);
    this.rootEl.style.setProperty("--sb-device-pixel-ratio", String(window.devicePixelRatio || 1));
    return changed;
  }

  observeResponsiveLayout() {
    if (!this.rootEl || typeof ResizeObserver === "undefined") return;
    this.lastResponsiveSize = {
      width: Math.round(this.rootEl.clientWidth),
      height: Math.round(this.rootEl.clientHeight),
      dpr: window.devicePixelRatio || 1,
    };
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        dpr: window.devicePixelRatio || 1,
      };
      const previous = this.lastResponsiveSize || {};
      if (Math.abs(next.width - (previous.width || 0)) < 4
        && Math.abs(next.height - (previous.height || 0)) < 4
        && Math.abs(next.dpr - (previous.dpr || 0)) < .01) return;
      this.lastResponsiveSize = next;
      this.updateResponsiveProfile(next.width, next.height);
      this.scheduleResponsiveRefresh();
    });
    this.resizeObserver.observe(this.rootEl);
  }

  scheduleResponsiveRefresh() {
    window.clearTimeout(this.responsiveTimer);
    this.responsiveTimer = window.setTimeout(() => {
      if (!this.rootEl?.isConnected) return;
      const width = Math.round(this.rootEl.clientWidth);
      const height = Math.round(this.rootEl.clientHeight);
      this.updateResponsiveProfile(width, height);
      if (this.graphTransitionAnimation) {
        this.scheduleResponsiveRefresh();
        return;
      }
      this.renderGraph();
    }, 120);
  }

  renderToolbar() {
    const toolbar = this.rootEl.createDiv({ cls: "sb-toolbar" });
    const titleGroup = toolbar.createDiv({ cls: "sb-toolbar-title" });
    const currentWeek = this.plugin.index.weekInfo(new Date());
    titleGroup.createEl("h2", { text: this.activePage === "calendar" ? "Календарь" : "Управление заданиями" });
    titleGroup.createEl("p", { text: this.activePage === "calendar" ? `${currentWeek.number} учебная неделя · ${currentWeek.label} · среда свободна` : "Быстрый переход к любому действию" });
    const navigation = toolbar.createDiv({ cls: "sb-toolbar-nav" });
    const calendarButton = navigation.createEl("button", { cls: `sb-nav-button ${this.activePage === "calendar" ? "is-active" : ""}`, text: "Календарь" });
    setIcon(calendarButton.createSpan(), "calendar-range");
    calendarButton.addEventListener("click", () => { this.activePage = "calendar"; this.render(); });
    const managementButton = navigation.createEl("button", { cls: `sb-nav-button ${this.activePage === "management" ? "is-active" : ""}`, text: "Управление" });
    setIcon(managementButton.createSpan(), "list-checks");
    managementButton.addEventListener("click", () => { this.activePage = "management"; this.render(); });
    const addButton = navigation.createEl("button", { cls: "sb-action-button mod-cta sb-main-add-button", text: "Добавить" });
    setIcon(addButton.createSpan(), "plus");
    const addChevron = addButton.createSpan({ cls: "sb-add-chevron" });
    setIcon(addChevron, "chevron-down");
    addButton.addEventListener("click", () => new AddItemModal(this.app, this.plugin, this.selectedQuantum).open());
  }

  renderPage() {
    this.mainEl.empty();
    if (this.activePage === "management") this.renderManagement();
    else this.renderCalendarWorkspace();
  }

  renderCalendarWorkspace() {
    const layout = this.mainEl.createDiv({ cls: "sb-calendar-layout" });
    const week = this.plugin.index.weekInfo(new Date());
    const calendarSection = this.section(
      layout,
      "1",
      this.calendarExpanded ? "Календарь месяца" : "Текущая неделя",
      this.calendarExpanded
        ? "Двойной клик по заголовку — вернуться к текущей неделе"
        : `${week.number} неделя · ${week.label} · двойной клик — раскрыть месяц`,
      "sb-calendar-section",
    );
    this.calendarSectionEl = calendarSection.section;
    calendarSection.head.addClass("sb-expandable-head");
    calendarSection.head.setAttr("title", "Двойной клик переключает неделю и месяц");
    calendarSection.head.createSpan({
      cls: "sb-section-toggle-hint",
      text: this.calendarExpanded ? "Свернуть до недели" : "Раскрыть месяц",
    });
    calendarSection.head.addEventListener("dblclick", () => void this.toggleCalendarExpanded());
    this.renderCalendar(calendarSection.body);
    this.focusBodyEl = null;
    const today = new Date();
    const todaySection = this.section(
      layout,
      "2",
      "Задачи на сегодня",
      `${new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(today)} · без учёта пар`,
      "sb-today-section",
    );
    todaySection.body.addClass("sb-today-body");
    this.todayBodyEl = todaySection.body;
    const deadlineSection = this.section(layout, "3", "Дедлайны и выполнение", "Сроки и этапы работы", "sb-deadline-section");
    deadlineSection.body.addClass("sb-deadline-body");
    this.deadlineBodyEl = deadlineSection.body;
    this.renderTodayTasks();
    this.renderDeadlines();
  }

  section(parent, number, title, subtitle, extraClass = "") {
    const section = parent.createDiv({ cls: `sb-section ${extraClass}` });
    const head = section.createDiv({ cls: "sb-section-head" });
    head.createSpan({ cls: "sb-section-number", text: number });
    const copy = head.createDiv({ cls: "sb-section-copy" });
    copy.createDiv({ cls: "sb-section-title", text: title });
    copy.createDiv({ cls: "sb-section-subtitle", text: subtitle });
    return { section, head, body: section.createDiv({ cls: "sb-section-body" }) };
  }

  async toggleCalendarExpanded() {
    if (!this.calendarSectionEl || this.calendarTransitioning) return;
    this.calendarTransitioning = true;
    const previousSection = this.calendarSectionEl;
    const previousRect = previousSection.getBoundingClientRect();
    const outgoingItems = [...previousSection.querySelectorAll(".sb-calendar-item")];
    const fades = outgoingItems.map((item) => item.animate([
      { opacity: getComputedStyle(item).opacity || 1 },
      { opacity: 0 },
    ], {
      duration: 90,
      easing: "ease-out",
      fill: "forwards",
    }));
    await Promise.allSettled(fades.map((animation) => animation.finished));

    this.calendarExpanded = !this.calendarExpanded;
    if (!this.calendarExpanded) this.currentDate = new Date();
    this.renderPage();
    const nextSection = this.calendarSectionEl;
    const nextRect = nextSection.getBoundingClientRect();
    if (!previousRect.width || !previousRect.height || !nextRect.width || !nextRect.height) {
      this.calendarTransitioning = false;
      return;
    }

    const offsetX = previousRect.left - nextRect.left;
    const offsetY = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / nextRect.width;
    const scaleY = previousRect.height / nextRect.height;
    nextSection.addClass("is-calendar-transitioning");
    const animation = nextSection.animate([
      {
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
        transformOrigin: "top left",
      },
      {
        transform: "translate(0, 0) scale(1, 1)",
        transformOrigin: "top left",
      },
    ], {
      duration: 340,
      easing: "cubic-bezier(.22, 1, .36, 1)",
      fill: "both",
    });
    this.calendarTransitionAnimation = animation;

    const incomingItems = [...nextSection.querySelectorAll(".sb-calendar-item")];
    for (const item of incomingItems) {
      item.animate([
        { opacity: 0 },
        { opacity: 1 },
      ], {
        duration: 170,
        delay: 95,
        easing: "ease-out",
        fill: "both",
      });
    }
    animation.onfinish = () => {
      nextSection.removeClass("is-calendar-transitioning");
      this.calendarTransitioning = false;
      if (this.calendarTransitionAnimation === animation) this.calendarTransitionAnimation = null;
    };
    animation.oncancel = () => {
      nextSection.removeClass("is-calendar-transitioning");
      this.calendarTransitioning = false;
    };
  }

  renderCalendar(body) {
    const controls = body.createDiv({ cls: "sb-calendar-controls" });
    if (this.calendarExpanded) {
      const previous = controls.createEl("button", { cls: "sb-icon-button", attr: { "aria-label": "Предыдущий месяц" } });
      setIcon(previous, "chevron-left");
      controls.createDiv({ cls: "sb-month-label", text: new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(this.currentDate) });
      const next = controls.createEl("button", { cls: "sb-icon-button", attr: { "aria-label": "Следующий месяц" } });
      setIcon(next, "chevron-right");
      previous.addEventListener("click", () => { this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1); this.renderPage(); });
      next.addEventListener("click", () => { this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 1); this.renderPage(); });
    } else {
      const monday = new Date(this.currentDate);
      monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const week = this.plugin.index.weekInfo(monday);
      const shortDate = (date) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
      controls.createDiv({
        cls: "sb-month-label sb-week-label",
        text: `${shortDate(monday)} — ${shortDate(sunday)} · ${week.number} неделя · ${week.label}`,
      });
    }

    const weekdays = body.createDiv({ cls: "sb-weekdays" });
    for (const day of ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]) weekdays.createDiv({ text: day });
    const grid = body.createDiv({ cls: `sb-calendar-grid ${this.calendarExpanded ? "is-month" : "is-week"}` });
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const today = new Date();
    const cells = [];
    if (this.calendarExpanded) {
      const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
      const firstCell = new Date(year, month, 1 - firstOffset, 12);
      for (let index = 0; index < 42; index += 1) {
        const date = new Date(firstCell);
        date.setDate(firstCell.getDate() + index);
        cells.push({ date, outside: date.getMonth() !== month });
      }
    } else {
      const monday = new Date(this.currentDate);
      monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      for (let index = 0; index < 7; index += 1) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        cells.push({ date, outside: false });
      }
    }

    for (const { date, outside } of cells) {
      const day = date.getDate();
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const dayEl = grid.createDiv({ cls: `sb-day ${outside ? "is-outside" : ""} ${date.toDateString() === today.toDateString() ? "is-today" : ""}` });
      dayEl.createDiv({ cls: "sb-day-number", text: String(day) });
      const sourceRecords = [
        ...this.plugin.index.classesForDate(date),
        ...this.plugin.index.deadlinesForDate(date),
        ...this.plugin.index.events.filter((record) => record.date === key),
        ...this.plugin.index.tasks.filter((record) => record.due === key && this.plugin.index.isVisible(record)),
      ].sort((a, b) => `${a.time || "99:99"}${a.type === "task" ? "0" : "1"}${a.title}`.localeCompare(`${b.time || "99:99"}${b.type === "task" ? "0" : "1"}${b.title}`));
      const records = sourceRecords.map((record) => record.type === "class" ? Object.assign({}, record, { date: key }) : record);
      const visibleLimit = this.calendarExpanded ? 4 : 10;
      for (const record of records.slice(0, visibleLimit)) {
        const lessonKind = record.type === "class" && ["lecture", "seminar"].includes(record.eventKind) ? ` is-${record.eventKind}` : "";
        const subjectKind = record.subject === "physical-education" ? " is-physical-education" : "";
        const item = dayEl.createEl("button", {
          cls: `sb-calendar-item is-${record.type}${lessonKind}${subjectKind}`,
          attr: { "aria-label": `${record.time ? `${record.time} ` : ""}${record.title}` },
        });
        const calendarLinkId = record.sourceAnchorId || record.sourceClassId || (["class", "event"].includes(record.type) ? record.id : "");
        if (calendarLinkId) {
          item.dataset.calendarLinkId = calendarLinkId;
          item.addEventListener("mouseenter", () => this.highlightCalendarLink(calendarLinkId, true));
          item.addEventListener("mouseleave", () => this.highlightCalendarLink(calendarLinkId, false));
          item.addEventListener("focus", () => this.highlightCalendarLink(calendarLinkId, true));
          item.addEventListener("blur", () => this.highlightCalendarLink(calendarLinkId, false));
        }
        item.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.clearPinnedQuantum();
        });
        if (record.time) item.createSpan({ cls: "sb-calendar-item-time", text: record.time });
        const titleParts = record.title.split(/\s+·\s+/).filter(Boolean);
        item.createSpan({ cls: "sb-calendar-item-title", text: titleParts.shift() || record.title });
        if (titleParts.length) item.createSpan({ cls: "sb-calendar-item-detail", text: titleParts.join(" · ") });
        this.decorateInteractive(item, record);
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          const subject = this.plugin.index.subjectFor(record);
          this.selectedQuantum = subject?.id || record.quantum || record.parent || record.id;
          this.selectedTaskId = record.type === "task" ? record.id : "";
          this.renderTodayTasks();
          this.renderDeadlines();
          this.highlightQuantum(this.selectedQuantum, true);
          this.pinContext(record);
        });
        item.addEventListener("dblclick", () => this.openRecord(record));
      }
      if (records.length > visibleLimit) dayEl.createDiv({ cls: "sb-more", text: `+${records.length - visibleLimit}` });
    }
    if (!this.calendarExpanded) {
      grid.style.setProperty("--sb-week-height", "150px");
      window.requestAnimationFrame(() => {
        if (!grid.isConnected) return;
        const measuredHeight = Math.max(150, ...[...grid.children].map((day) => day.scrollHeight + 2));
        grid.style.setProperty("--sb-week-height", `${Math.ceil(measuredHeight)}px`);
      });
    }
  }

  renderTodayTasks() {
    if (!this.todayBodyEl) return;
    this.todayBodyEl.empty();
    const key = localDateKey(new Date());
    const today = new Date(`${key}T12:00:00`);
    const records = [
      ...this.plugin.index.deadlinesForDate(today),
      ...this.plugin.index.events.filter((record) => record.date === key),
      ...this.plugin.index.tasks.filter((record) => record.due === key && this.plugin.index.isVisible(record)),
    ].sort((a, b) => `${a.time || "99:99"}${a.title}`.localeCompare(`${b.time || "99:99"}${b.title}`, "ru"));

    const top = this.todayBodyEl.createDiv({ cls: "sb-today-top" });
    top.createDiv({
      cls: "sb-today-count",
      text: records.length ? `${records.length} ${records.length === 1 ? "задача" : records.length < 5 ? "задачи" : "задач"}` : "На сегодня задач нет",
    });
    const add = top.createEl("button", { cls: "sb-small-button", text: "Добавить задачу" });
    setIcon(add.createSpan(), "plus");
    add.addEventListener("click", () => new NewTaskModal(this.app, this.plugin, this.selectedQuantum).open());

    const list = this.todayBodyEl.createDiv({ cls: "sb-today-list" });
    if (!records.length) {
      list.createDiv({ cls: "sb-empty", text: "Свободное место для текущих дел — пары сюда не попадают." });
      return;
    }
    for (const record of records) {
      const subject = this.plugin.index.subjectFor(record);
      const row = list.createEl("button", { cls: `sb-today-task is-${record.type}` });
      const icon = row.createSpan({ cls: "sb-today-icon" });
      setIcon(icon, record.type === "task" ? "circle-check" : "calendar-clock");
      const copy = row.createDiv({ cls: "sb-today-copy" });
      copy.createDiv({ cls: "sb-today-title", text: record.title });
      copy.createDiv({
        cls: "sb-today-meta",
        text: [
          record.time,
          record.sourceAnchorTitle ? `к событию: ${record.sourceAnchorTitle}` : record.sourceClassTitle ? `к семинару: ${record.sourceClassTitle}` : subject?.title,
          record.type === "task" ? `${record.progress}%` : "Событие",
        ].filter(Boolean).join(" · "),
      });
      row.createSpan({ cls: "sb-today-open", text: "Открыть" });
      const calendarLinkId = record.sourceAnchorId || record.sourceClassId;
      if (calendarLinkId) {
        row.dataset.calendarLinkId = calendarLinkId;
        row.addEventListener("mouseenter", () => this.highlightCalendarLink(calendarLinkId, true));
        row.addEventListener("mouseleave", () => this.highlightCalendarLink(calendarLinkId, false));
        row.addEventListener("focus", () => this.highlightCalendarLink(calendarLinkId, true));
        row.addEventListener("blur", () => this.highlightCalendarLink(calendarLinkId, false));
      }
      this.decorateInteractive(row, record);
      row.addEventListener("click", () => {
        this.selectedTaskId = record.type === "task" ? record.id : "";
        this.selectedQuantum = subject?.id || record.quantum || record.parent || this.selectedQuantum;
        this.renderDeadlines();
        this.highlightQuantum(this.selectedQuantum, true);
        this.pinContext(record);
      });
      row.addEventListener("dblclick", () => this.openRecord(record));
    }
  }

  renderFocus() {
    if (!this.focusBodyEl) return;
    this.focusBodyEl.empty();
    const selected = this.plugin.index.byId.get(this.selectedQuantum) || this.plugin.index.nodes[0];
    if (!selected) {
      this.focusBodyEl.createDiv({ cls: "sb-empty", text: "Добавьте предметы и кванты в Markdown" });
      return;
    }
    const subject = this.plugin.index.subjectFor(selected) || selected;
    const top = this.focusBodyEl.createDiv({ cls: "sb-focus-top" });
    const copy = top.createDiv();
    copy.createDiv({ cls: "sb-focus-title", text: selected.title });
    copy.createDiv({ cls: "sb-focus-meta", text: [subject.teacher, subject.room].filter(Boolean).join(" · ") || subject.title });
    top.createSpan({ cls: `sb-quantum-dot is-${selected.type}` });
    this.decorateInteractive(top, selected);
    const next = this.focusBodyEl.createDiv({ cls: "sb-next-action" });
    next.createDiv({ cls: "sb-eyebrow", text: "СЛЕДУЮЩИЙ ШАГ" });
    next.createDiv({ cls: "sb-next-copy", text: selected.nextAction || subject.nextAction || this.plugin.index.tasksForQuantum(subject.id)[0]?.title || "Выбрать следующее действие" });
    this.decorateInteractive(next, selected);
    const hierarchy = this.plugin.index.ancestors(selected.id);
    const path = [...hierarchy].reverse().map((id) => this.plugin.index.byId.get(id)?.title).filter(Boolean);
    path.push(selected.title);
    this.focusBodyEl.createDiv({ cls: "sb-quantum-path", text: path.join(" → ") });
    const actions = this.focusBodyEl.createDiv({ cls: "sb-focus-actions" });
    const open = actions.createEl("button", { cls: "sb-small-button", text: "Открыть заметку" });
    setIcon(open.createSpan(), "file-text");
    open.addEventListener("click", () => this.openRecord(selected));
    const parent = actions.createEl("button", { cls: "sb-small-button", text: "На уровень выше" });
    setIcon(parent.createSpan(), "corner-left-up");
    parent.disabled = !selected.parent;
    parent.addEventListener("click", () => { if (selected.parent) { this.selectedQuantum = selected.parent; this.renderFocus(); this.renderDeadlines(); this.highlightQuantum(selected.parent, true); } });
  }

  renderDeadlines() {
    if (!this.deadlineBodyEl) return;
    this.deadlineBodyEl.empty();
    const trackedTasks = this.plugin.index.tasksForQuantum(this.selectedQuantum).filter((record) => this.plugin.index.isVisible(record));
    const manualDeadlines = this.plugin.index.manualDeadlineOccurrences();
    const recurringDeadlines = this.plugin.index.allUpcomingRecurringDeadlines();
    const tasks = [...trackedTasks, ...manualDeadlines, ...recurringDeadlines].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const recurringProjects = [...new Set(recurringDeadlines.map((task) => task.quantum))]
      .map((id) => this.plugin.index.byId.get(id))
      .filter(Boolean);
    const manualDeadlineSources = this.plugin.index.deadlines.filter((record) => this.plugin.index.isVisible(record));
    const progressSources = [...trackedTasks, ...manualDeadlineSources, ...recurringProjects];
    const progress = progressSources.length ? Math.round(progressSources.reduce((sum, item) => sum + item.progress, 0) / progressSources.length) : 0;
    const summary = this.deadlineBodyEl.createDiv({ cls: "sb-progress-summary" });
    const ring = summary.createDiv({ cls: "sb-progress-ring" });
    ring.style.setProperty("--sb-progress", `${progress}%`);
    ring.createSpan({ text: `${progress}%` });
    const summaryCopy = summary.createDiv();
    summaryCopy.createDiv({ cls: "sb-progress-title", text: "Процесс выполнения" });
    const deadlineSeries = new Set([...manualDeadlineSources.map((record) => record.id), ...recurringProjects.map((record) => record.id)]);
    summaryCopy.createDiv({ cls: "sb-progress-meta", text: `${trackedTasks.length} заданий · ${deadlineSeries.size} серий дедлайнов` });
    const addDeadline = summary.createEl("button", { cls: "sb-small-button sb-add-deadline", text: "Добавить дедлайн", attr: { title: "Добавить дедлайн" } });
    setIcon(addDeadline.createSpan(), "plus");
    addDeadline.addEventListener("click", () => new NewDeadlineModal(this.app, this.plugin, this.selectedQuantum).open());
    const list = this.deadlineBodyEl.createDiv({ cls: "sb-deadline-list" });
    if (!tasks.length) list.createDiv({ cls: "sb-empty", text: "Пока нет видимых заданий и дедлайнов" });
    const groups = new Map();
    for (const task of tasks) {
      const topicId = task.quantum || task.parent || task.subject;
      const key = task.deadlineGroupId ? `deadline:${task.deadlineGroupId}` : topicId ? `topic:${topicId}` : `task:${task.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }

    for (const groupTasks of groups.values()) {
      groupTasks.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      const today = localDateKey(new Date());
      const nearest = groupTasks.find((task) => !task.due || task.due >= today) || groupTasks[groupTasks.length - 1];
      const subsequent = groupTasks.filter((task) => task.id !== nearest.id);
      const topic = this.plugin.index.byId.get(nearest.quantum || nearest.parent);
      const origin = this.plugin.index.byId.get(nearest.originId);
      const project = topic?.weeklyGoal ? topic : null;
      const row = list.createDiv({ cls: `sb-deadline sb-deadline-group ${groupTasks.some((task) => task.id === this.selectedTaskId) ? "is-selected" : ""}` });
      const head = row.createDiv({ cls: "sb-deadline-group-head" });
      head.createSpan({ cls: `sb-status-dot ${nearest.progress >= 100 ? "is-done" : nearest.due && nearest.due < today ? "is-late" : ""}` });
      const copy = head.createDiv({ cls: "sb-deadline-copy" });
      copy.createDiv({ cls: "sb-deadline-title", text: project?.title || origin?.title || nearest.title });
      copy.createDiv({
        cls: "sb-deadline-meta",
        text: [
          `${nearest.status} · ${nearest.progress}%${subsequent.length ? ` · ещё ${subsequent.length}` : ""}`,
          nearest.stageTitle ? `этап: ${nearest.stageTitle}` : "",
          nearest.sourceAnchorTitle ? `к событию: ${nearest.sourceAnchorTitle}` : "",
          topic?.title ? `тема: ${topic.title}` : "",
        ].filter(Boolean).join(" · "),
      });
      head.createDiv({ cls: "sb-deadline-date", text: formatDate(nearest.due) });

      if (project) {
        const goal = row.createDiv({ cls: "sb-weekly-goal" });
        goal.createDiv({ cls: "sb-eyebrow", text: "ЦЕЛЬ НА НЕДЕЛЮ" });
        goal.createDiv({ cls: "sb-weekly-goal-text", text: project.weeklyGoal || "Определить результат к ближайшему семинару" });
        const bar = goal.createDiv({ cls: "sb-linear-progress sb-weekly-progress" });
        const fill = bar.createDiv();
        fill.style.width = `${project.progress}%`;
        const resultRow = goal.createDiv({ cls: "sb-weekly-result" });
        resultRow.createSpan({ text: "Результат" });
        const result = resultRow.createEl("select", { cls: "dropdown" });
        for (const [value, label] of [["pending", "Не оценён"], ["partial", "Частично"], ["done", "Выполнено"]]) {
          result.createEl("option", { value, text: label });
        }
        result.value = project.weeklyGoalDate === nearest.due ? project.weeklyResult : "pending";
        result.addEventListener("click", (event) => event.stopPropagation());
        result.addEventListener("change", async (event) => {
          event.stopPropagation();
          await this.updateWeeklyResult(project, result.value, nearest.due);
        });
      }

      if (subsequent.length) {
        const future = row.createEl("details", { cls: "sb-future-deadlines" });
        future.addEventListener("click", (event) => event.stopPropagation());
        future.createEl("summary", { text: `Все остальные даты (${subsequent.length})` });
        const dates = future.createDiv({ cls: "sb-future-date-list" });
        for (const task of subsequent) dates.createDiv({ text: `${formatDate(task.due)} · ${task.stageTitle || task.title}${task.sourceAnchorTitle ? ` · ${task.sourceAnchorTitle}` : ""}` });
      }

      const actions = row.createDiv({ cls: "sb-deadline-group-actions" });
      const actionable = origin || nearest;
      if (isCompleted(actionable)) {
        const resume = actions.createEl("button", { cls: "sb-small-button sb-resume-button", text: "Возобновить" });
        setIcon(resume.createSpan(), "rotate-ccw");
        resume.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.plugin.setRecordCompletion(actionable, false);
        });
        const remove = actions.createEl("button", { cls: "sb-small-button sb-delete-button", text: "Удалить" });
        setIcon(remove.createSpan(), "trash-2");
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          new DeleteRecordModal(this.app, this.plugin, actionable).open();
        });
      } else {
        const complete = actions.createEl("button", { cls: "sb-small-button sb-complete-button", text: "Выполнено" });
        setIcon(complete.createSpan(), "check");
        complete.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.plugin.setRecordCompletion(actionable, true);
        });
      }
      if (nearest.isManualDeadline || nearest.originId || nearest.sourceClassId) {
        const visibility = actions.createEl("button", { cls: "sb-small-button", text: "Скрыть до…" });
        setIcon(visibility.createSpan(), "eye-off");
        visibility.addEventListener("click", (event) => {
          event.stopPropagation();
          new DeadlineVisibilityModal(this.app, this.plugin, origin || nearest).open();
        });
      }
      const open = actions.createEl("button", { cls: "sb-small-button", text: "Открыть" });
      setIcon(open.createSpan(), "file-text");
      open.addEventListener("click", (event) => { event.stopPropagation(); this.openRecord(nearest); });
      this.decorateInteractive(row, nearest);
      row.addEventListener("click", () => {
        this.selectedTaskId = nearest.id;
        this.selectedQuantum = nearest.quantum || nearest.parent || this.selectedQuantum;
        this.highlightQuantum(this.selectedQuantum, true);
        this.pinContext(nearest);
        this.renderDeadlines();
      });
    }
  }

  async updateWeeklyResult(project, nextResult, goalDate) {
    const file = this.app.vault.getAbstractFileByPath(project.path);
    if (!(file instanceof TFile)) return;
    const factors = { pending: 0, partial: .5, done: 1 };
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const sameGoal = dateKey(frontmatter["weekly-goal-date"]) === goalDate;
      const previousResult = sameGoal ? asString(frontmatter["weekly-result"] || "pending") : "pending";
      const step = Math.max(1, safeNumber(frontmatter["progress-step"], project.progressStep || 10));
      const current = Math.max(0, Math.min(100, safeNumber(frontmatter.progress, project.progress)));
      const delta = ((factors[nextResult] || 0) - (factors[previousResult] || 0)) * step;
      frontmatter.progress = Math.max(0, Math.min(100, Math.round(current + delta)));
      frontmatter["weekly-result"] = nextResult;
      frontmatter["weekly-goal-date"] = goalDate;
      const history = frontmatter["weekly-results"] && typeof frontmatter["weekly-results"] === "object"
        ? frontmatter["weekly-results"]
        : {};
      history[goalDate] = nextResult;
      frontmatter["weekly-results"] = history;
    });
    new Notice("Результат недели и прогресс проекта обновлены");
  }

  renderManagement() {
    const layout = this.mainEl.createDiv({ cls: "sb-management-layout" });
    const browser = layout.createDiv({ cls: "sb-task-browser" });
    const search = browser.createEl("input", { cls: "sb-task-search", attr: { type: "search", placeholder: "Прыгнуть к заданию, предмету или дедлайну…" } });
    const list = browser.createDiv({ cls: "sb-task-list" });
    const preview = layout.createDiv({ cls: "sb-task-preview" });
    const renderList = () => {
      const query = search.value.trim().toLocaleLowerCase("ru");
      list.empty();
      const matching = this.plugin.index.tasks.filter((task) => {
        const subject = this.plugin.index.subjectFor(task);
        return `${task.title} ${subject?.title || ""} ${task.status}`.toLocaleLowerCase("ru").includes(query);
      });
      for (const task of matching) {
        const subject = this.plugin.index.subjectFor(task);
        const button = list.createEl("button", { cls: `sb-task-jump ${task.id === this.selectedTaskId ? "is-selected" : ""}` });
        const icon = button.createSpan();
        setIcon(icon, "circle-check");
        const copy = button.createDiv();
        copy.createDiv({ cls: "sb-task-jump-title", text: task.title });
        copy.createDiv({ cls: "sb-task-jump-meta", text: `${subject?.title || "Без предмета"} · ${task.status}` });
        button.createSpan({ cls: "sb-task-jump-date", text: formatDate(task.due) });
        this.decorateInteractive(button, task);
        button.addEventListener("click", () => {
          this.selectedTaskId = task.id;
          this.selectedQuantum = task.quantum || task.parent;
          this.highlightQuantum(this.selectedQuantum, true);
          renderList();
          this.renderTaskPreview(preview, task);
          this.pinContext(task);
        });
      }
      if (!matching.length) list.createDiv({ cls: "sb-empty", text: "Ничего не найдено" });
    };
    search.addEventListener("input", renderList);
    const selected = this.plugin.index.byId.get(this.selectedTaskId) || this.plugin.index.tasks[0];
    if (selected) { this.selectedTaskId = selected.id; this.renderTaskPreview(preview, selected); }
    else preview.createDiv({ cls: "sb-empty", text: "Добавьте первое задание" });
    renderList();
  }

  renderTaskPreview(preview, task) {
    preview.empty();
    const subject = this.plugin.index.subjectFor(task);
    preview.createDiv({ cls: "sb-eyebrow", text: task.type.toUpperCase() });
    preview.createDiv({ cls: "sb-task-preview-title", text: task.title });
    const properties = [
      ["Предмет", subject?.title || "—"],
      ["Дедлайн", formatDate(task.due)],
      ["Статус", `${task.status} · ${task.progress}%`],
      ["Квант", this.plugin.index.byId.get(task.quantum || task.parent)?.title || task.quantum || task.parent],
    ];
    for (const [name, current] of properties) {
      const row = preview.createDiv({ cls: "sb-preview-property" });
      row.createSpan({ text: name });
      row.createSpan({ text: current || "—" });
    }
    if (task.summary) preview.createEl("p", { cls: "sb-preview-summary", text: task.summary });
    const bar = preview.createDiv({ cls: "sb-linear-progress" });
    const fill = bar.createDiv();
    fill.style.width = `${task.progress}%`;
    const open = preview.createEl("button", { cls: "sb-action-button mod-cta", text: "Открыть описание" });
    open.addEventListener("click", () => this.openRecord(task));
  }

  decorateInteractive(element, record) {
    const quantumId = record.type === "subject" || record.type === "quantum" ? record.id : record.quantum || record.parent || record.subject || record.id;
    element.dataset.quantumId = quantumId;
    element.addEventListener("mouseenter", () => { this.showContext(record); this.highlightQuantum(quantumId); });
    element.addEventListener("mouseleave", () => { this.hideContext(); this.clearHighlight(); });
    element.addEventListener("focus", () => { this.showContext(record); this.highlightQuantum(quantumId); });
    element.addEventListener("blur", () => { this.hideContext(); this.clearHighlight(); });
  }

  highlightCalendarLink(linkId, active) {
    if (!linkId || !this.rootEl) return;
    this.rootEl.querySelectorAll("[data-calendar-link-id]").forEach((element) => {
      element.toggleClass("is-linked-calendar", active && element.dataset.calendarLinkId === linkId);
    });
  }

  showContext(record) {
    window.clearTimeout(this.hideContextTimer);
    this.contextCardEl.empty();
    const subject = this.plugin.index.subjectFor(record);
    const top = this.contextCardEl.createDiv({ cls: "sb-context-top" });
    const copy = top.createDiv();
    copy.createDiv({ cls: "sb-eyebrow", text: record.type.toUpperCase() });
    copy.createDiv({ cls: "sb-context-title", text: record.title });
    const pin = top.createEl("button", { cls: "sb-icon-button", attr: { "aria-label": "Закрепить контекст" } });
    setIcon(pin, "pin");
    pin.addEventListener("click", () => {
      this.contextPinned = !this.contextPinned;
      this.contextSlotEl.toggleClass("is-pinned", this.contextPinned);
    });
    this.contextCardEl.createEl("p", { cls: "sb-context-summary", text: record.summary || "Контекст хранится в свойствах и тексте Markdown-заметки." });
    const when = record.type === "class"
      ? `${formatDate(record.date)} · ${record.time || ""}${record.endTime ? `–${record.endTime}` : ""}`
      : formatDate(record.due || record.date);
    const properties = [
      ["Предмет", subject?.title || (record.type === "subject" ? record.title : "—")],
      ...(record.sourceClassTitle ? [["Связано с", record.sourceClassTitle]] : []),
      ["Состояние", record.status || "active"],
      [record.type === "class" ? "Когда" : "Срок", when],
      ["Место", [record.room, record.campus].filter(Boolean).join(" · ") || "—"],
      ["Прогресс", `${record.progress}%`],
    ];
    for (const [name, current] of properties) {
      const row = this.contextCardEl.createDiv({ cls: "sb-context-property" });
      row.createSpan({ text: name });
      row.createSpan({ text: current });
    }
    const actions = this.contextCardEl.createDiv({ cls: "sb-context-actions" });
    const open = actions.createEl("button", { cls: "sb-action-button mod-cta", text: "Открыть" });
    open.addEventListener("click", () => this.openRecord(record));
    this.contextSlotEl.addClass("is-visible");
  }

  pinContext(record) {
    this.showContext(record);
    this.contextPinned = true;
    this.contextSlotEl.addClass("is-pinned");
  }

  hideContext() {
    if (this.contextPinned) return;
    this.hideContextTimer = window.setTimeout(() => this.contextSlotEl.removeClass("is-visible"), 100);
  }

  renderGraph() {
    if (this.graphAnimationFrame) window.cancelAnimationFrame(this.graphAnimationFrame);
    this.graphHostEl.empty();
    const dock = this.graphHostEl.createDiv({ cls: `sb-graph-dock ${this.graphExpanded ? "is-expanded" : ""}` });
    this.graphDockEl = dock;
    const header = dock.createDiv({ cls: "sb-graph-header" });
    const icon = header.createSpan();
    setIcon(icon, "waypoints");
    header.createSpan({ cls: "sb-graph-title", text: "Граф знаний" });
    this.graphStateEl = header.createSpan({
      cls: "sb-graph-state",
      text: this.graphExpanded
        ? `${this.plugin.index.nodes.length} квантов · все названия показаны`
        : `${this.plugin.index.nodes.length} квантов · наведите, чтобы раскрыть ветку`,
    });
    const viewport = dock.createDiv({ cls: "sb-graph-canvas" });
    this.graphCanvasEl = viewport;
    const plane = viewport.createDiv({ cls: "sb-graph-plane" });
    viewport.addEventListener("click", (event) => {
      if (event.target.closest(".sb-graph-node")) return;
      this.toggleGraphExpanded();
    });
    this.drawGraph(plane);
    if (this.persistentHighlight) this.highlightQuantum(this.persistentHighlight, true);
  }

  toggleGraphExpanded(force) {
    const nextState = typeof force === "boolean" ? force : !this.graphExpanded;
    if (nextState === this.graphExpanded || !this.graphDockEl) return;
    this.graphTransitionAnimation?.cancel();
    const previousRect = this.graphDockEl.getBoundingClientRect();
    const previousWidth = Number.parseFloat(this.graphPlaneEl?.style.width) || this.graphLayoutWidth || 1;
    const previousHeight = Number.parseFloat(this.graphPlaneEl?.style.height) || this.graphLayoutHeight || 1;
    const previousRatios = new Map();
    for (const [id, point] of this.graphCurrentPositions || []) {
      previousRatios.set(id, { x: point.x / previousWidth, y: point.y / previousHeight });
    }
    this.graphExpanded = nextState;
    this.renderGraph();
    const nextDock = this.graphDockEl;
    const nextRect = nextDock.getBoundingClientRect();
    if (!previousRect.width || !previousRect.height || !nextRect.width || !nextRect.height) return;

    if (this.graphAnimationFrame) window.cancelAnimationFrame(this.graphAnimationFrame);
    const destination = this.graphTargetPositions || this.graphBasePositions;
    const labelled = this.graphTargetLabels || new Set();
    const morphStart = new Map();
    for (const [id, target] of destination) {
      const ratio = previousRatios.get(id);
      morphStart.set(id, ratio ? {
        x: ratio.x * this.graphLayoutWidth,
        y: ratio.y * this.graphLayoutHeight,
      } : { ...target });
    }
    this.applyGraphFrame(morphStart, labelled);
    this.animateGraphTo(destination, labelled, 320);

    const offsetX = previousRect.left - nextRect.left;
    const offsetY = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / nextRect.width;
    const scaleY = previousRect.height / nextRect.height;
    nextDock.addClass("is-transitioning");
    const animation = nextDock.animate([
      {
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
        transformOrigin: "top left",
        opacity: .82,
      },
      {
        transform: "translate(0, 0) scale(1, 1)",
        transformOrigin: "top left",
        opacity: 1,
      },
    ], {
      duration: 320,
      easing: "cubic-bezier(.22, 1, .36, 1)",
      fill: "both",
    });
    this.graphTransitionAnimation = animation;
    animation.onfinish = () => {
      nextDock.removeClass("is-transitioning");
      if (this.graphTransitionAnimation === animation) this.graphTransitionAnimation = null;
    };
    animation.oncancel = () => nextDock.removeClass("is-transitioning");
  }

  graphExpandedWidthFor(node) {
    const profile = this.rootEl?.dataset.layout || "medium";
    const characterWidth = profile === "large" ? 7.6 : profile === "compact" ? 6.2 : 7;
    const padding = profile === "large" ? 32 : profile === "compact" ? 24 : 28;
    return Math.max(profile === "compact" ? 56 : 64, node.title.length * characterWidth + padding);
  }

  graphLayout() {
    const nodes = this.plugin.index.nodes;
    const depthMemo = new Map();
    const depthOf = (node, seen = new Set()) => {
      if (depthMemo.has(node.id)) return depthMemo.get(node.id);
      if (!node.parent || !this.plugin.index.byId.has(node.parent) || seen.has(node.id)) return 0;
      seen.add(node.id);
      const parent = this.plugin.index.byId.get(node.parent);
      const depth = depthOf(parent, seen) + 1;
      depthMemo.set(node.id, depth);
      return depth;
    };
    const levels = new Map();
    for (const node of nodes) {
      const depth = depthOf(node);
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push(node);
    }
    const branchOf = (node) => {
      let current = node;
      let branch = node;
      let guard = 0;
      while (current?.parent && this.plugin.index.byId.has(current.parent) && guard < 100) {
        branch = current;
        current = this.plugin.index.byId.get(current.parent);
        guard += 1;
      }
      return branch;
    };
    const positions = new Map();
    const width = Math.max(360, this.graphCanvasEl?.clientWidth || 1100);
    const height = Math.max(220, this.graphCanvasEl?.clientHeight || (this.graphExpanded ? 680 : 248));
    const profile = this.rootEl?.dataset.layout || "medium";
    const rowHeight = profile === "large" ? 28 : profile === "compact" ? 20 : 24;
    const sortedDepths = [...levels.keys()].sort((a, b) => a - b);
    for (const levelNodes of levels.values()) {
      levelNodes.sort((a, b) => {
        const branchCompare = branchOf(a).title.localeCompare(branchOf(b).title, "ru");
        if (branchCompare) return branchCompare;
        const parentCompare = (a.parent || "").localeCompare(b.parent || "", "ru");
        return parentCompare || a.title.localeCompare(b.title, "ru");
      });
    }

    if (this.graphExpanded) {
      const orderedNodes = [...nodes].sort((a, b) => {
        const branchCompare = branchOf(a).title.localeCompare(branchOf(b).title, "ru");
        if (branchCompare) return branchCompare;
        const depthCompare = depthOf(a) - depthOf(b);
        if (depthCompare) return depthCompare;
        const parentCompare = (a.parent || "").localeCompare(b.parent || "", "ru");
        return parentCompare || a.title.localeCompare(b.title, "ru");
      });
      const edgePadding = 18;
      const gap = 18;
      const stagger = 30;
      const rows = [];
      let row = [];
      let rowWidth = 0;
      for (const node of orderedNodes) {
        const nodeWidth = this.graphExpandedWidthFor(node);
        const rowIndex = rows.length;
        const available = width - edgePadding * 2 - (rowIndex % 2 ? stagger : 0);
        const candidate = rowWidth + (row.length ? gap : 0) + nodeWidth;
        if (row.length && candidate > available) {
          rows.push(row);
          row = [];
          rowWidth = 0;
        }
        row.push({ node, width: nodeWidth });
        rowWidth += (row.length > 1 ? gap : 0) + nodeWidth;
      }
      if (row.length) rows.push(row);

      const topPadding = 24;
      const usableHeight = Math.max(0, height - topPadding * 2);
      const expandedRowStep = rows.length > 1 ? usableHeight / (rows.length - 1) : 0;
      rows.forEach((rowNodes, rowIndex) => {
        const totalWidth = rowNodes.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, rowNodes.length - 1);
        const desiredStart = (width - totalWidth) / 2 + (rowIndex % 2 ? stagger : 0);
        let cursor = Math.min(width - edgePadding - totalWidth, Math.max(edgePadding, desiredStart));
        const y = rows.length > 1 ? topPadding + rowIndex * expandedRowStep : height / 2;
        for (const item of rowNodes) {
          positions.set(item.node.id, { x: cursor + item.width / 2, y });
          cursor += item.width + gap;
        }
      });
      return { positions, width, height, rowHeight, expanded: true };
    }

    const rowsPerColumn = Math.max(6, Math.floor((height - 40) / rowHeight) + 1);
    const plans = [];
    for (const depth of sortedDepths) {
      const levelNodes = levels.get(depth);
      const columnsUsed = Math.max(1, Math.ceil(levelNodes.length / rowsPerColumn));
      plans.push({ levelNodes, columnsUsed });
    }
    const totalColumns = plans.reduce((sum, plan) => sum + plan.columnsUsed, 0);
    const sidePadding = 22;
    const columnStep = totalColumns > 1 ? (width - sidePadding * 2) / (totalColumns - 1) : 0;
    let globalColumn = 0;
    for (const { levelNodes, columnsUsed } of plans) {
      for (let localColumn = 0; localColumn < columnsUsed; localColumn += 1) {
        const columnNodes = levelNodes.slice(localColumn * rowsPerColumn, (localColumn + 1) * rowsPerColumn);
        const yStart = (height - (columnNodes.length - 1) * rowHeight) / 2;
        columnNodes.forEach((node, row) => {
          positions.set(node.id, {
            x: totalColumns > 1 ? sidePadding + globalColumn * columnStep : width / 2,
            y: yStart + row * rowHeight,
          });
        });
        globalColumn += 1;
      }
    }
    return {
      positions,
      width,
      height,
      rowHeight,
    };
  }

  drawGraph(canvas) {
    const { positions, width, height, rowHeight } = this.graphLayout();
    this.graphPlaneEl = canvas;
    this.graphBasePositions = positions;
    this.graphCurrentPositions = new Map([...positions].map(([id, point]) => [id, { ...point }]));
    this.graphLayoutWidth = width;
    this.graphLayoutHeight = height;
    this.graphRowHeight = rowHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "sb-graph-lines");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    this.graphSvgEl = svg;
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient.setAttribute("id", "sb-active-gradient");
    gradient.setAttribute("x1", "0"); gradient.setAttribute("y1", "0"); gradient.setAttribute("x2", "1"); gradient.setAttribute("y2", "0");
    for (const [offset, color, opacity] of [["0%", "var(--interactive-accent)", ".15"], ["55%", "var(--color-purple)", "1"], ["100%", "var(--color-blue)", "1"]]) {
      const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      stop.setAttribute("offset", offset); stop.setAttribute("stop-color", color); stop.setAttribute("stop-opacity", opacity); gradient.appendChild(stop);
    }
    defs.appendChild(gradient); svg.appendChild(defs);
    this.graphEdges = [];
    for (const node of this.plugin.index.nodes) {
      if (!node.parent || !positions.has(node.parent)) continue;
      const edge = document.createElementNS("http://www.w3.org/2000/svg", "path");
      edge.setAttribute("class", "sb-graph-line");
      edge.dataset.parent = node.parent; edge.dataset.child = node.id;
      svg.appendChild(edge); this.graphEdges.push(edge);
    }
    canvas.appendChild(svg);
    this.graphNodes = new Map();
    for (const node of this.plugin.index.nodes) {
      const position = positions.get(node.id); if (!position) continue;
      const button = canvas.createEl("button", {
        cls: `sb-graph-node is-${node.type}`,
        attr: { "aria-label": node.title },
      });
      const label = button.createSpan({ cls: "sb-graph-node-label", text: node.title });
      button.style.left = `${position.x}px`; button.style.top = `${position.y}px`;
      button.dataset.quantumId = node.id;
      button.dataset.expandedWidth = String(this.graphExpandedWidthFor(node));
      button.addEventListener("mouseenter", () => { this.showContext(node); this.highlightQuantum(node.id); });
      button.addEventListener("mouseleave", () => { this.hideContext(); this.clearHighlight(); });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.selectedQuantum = node.id;
        this.highlightQuantum(node.id, true);
        void this.plugin.rememberQuantum(node.id);
        if (this.activePage === "calendar") { this.renderFocus(); this.renderDeadlines(); }
        this.pinContext(node);
      });
      button.addEventListener("dblclick", async (event) => {
        event.stopPropagation();
        this.selectedQuantum = node.id;
        this.persistentHighlight = node.id;
        await this.plugin.rememberQuantum(node.id);
        this.highlightQuantum(node.id, true);
        await this.openRecord(node, true);
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearPinnedQuantum();
      });
      this.graphNodes.set(node.id, button);
    }
    const initialLabels = this.graphExpanded ? new Set(this.plugin.index.nodes.map((node) => node.id)) : new Set();
    for (const [id, element] of this.graphNodes) element.toggleClass("is-labelled", initialLabels.has(id));
    this.applyGraphFrame(positions, initialLabels);
    this.graphTargetPositions = positions;
    this.graphTargetLabels = initialLabels;
    canvas.createDiv({ cls: "sb-graph-hint", text: this.graphExpanded ? "Нажмите на пустую область, чтобы вернуть граф вниз" : "Нажмите на пустую область, чтобы развернуть граф" });
  }

  graphNodeSize(id, labelled) {
    const element = this.graphNodes?.get(id);
    const profile = this.rootEl?.dataset.layout || "medium";
    const circle = profile === "large" ? 14 : profile === "compact" ? 10 : 12;
    if (!labelled.has(id)) return { width: circle, height: circle };
    return {
      width: safeNumber(element?.dataset.expandedWidth, 96),
      height: profile === "large" ? 36 : profile === "compact" ? 28 : 32,
    };
  }

  graphPositionsForFocus(focus, anchorId) {
    const positions = new Map([...this.graphBasePositions].map(([id, point]) => [id, { ...point }]));
    const nodes = this.plugin.index.nodes.filter((node) => positions.has(node.id));
    const moved = new Set();
    for (const id of focus) {
      const point = positions.get(id); if (!point) continue;
      const size = this.graphNodeSize(id, focus);
      const minimum = size.width / 2 + 14;
      const maximum = this.graphLayoutWidth - size.width / 2 - 14;
      point.x = minimum <= maximum ? Math.min(maximum, Math.max(minimum, point.x)) : this.graphLayoutWidth / 2;
    }
    const overlaps = (a, b) => {
      const pointA = positions.get(a.id); const pointB = positions.get(b.id);
      const sizeA = this.graphNodeSize(a.id, focus); const sizeB = this.graphNodeSize(b.id, focus);
      return Math.abs(pointA.x - pointB.x) < (sizeA.width + sizeB.width) / 2 + 7
        && Math.abs(pointA.y - pointB.y) < (sizeA.height + sizeB.height) / 2 + 7;
    };

    const maxPasses = Math.max(40, nodes.length * 5);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let changed = false;
      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const first = nodes[left]; const second = nodes[right];
          if (!focus.has(first.id) && !focus.has(second.id) && !moved.has(first.id) && !moved.has(second.id)) continue;
          if (!overlaps(first, second)) continue;
          let mover = second;
          if (second.id === anchorId) mover = first;
          else if (first.id === anchorId) mover = second;
          else if (focus.has(first.id) && !focus.has(second.id)) mover = second;
          else if (!focus.has(first.id) && focus.has(second.id)) mover = first;
          positions.get(mover.id).y += this.graphRowHeight;
          moved.add(mover.id);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return positions;
  }

  setGraphSurface(width, height) {
    if (!this.graphPlaneEl || !this.graphSvgEl) return;
    this.graphPlaneEl.style.width = `${width}px`;
    this.graphPlaneEl.style.height = `${height}px`;
    this.graphSvgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.graphSvgEl.setAttribute("width", String(width));
    this.graphSvgEl.setAttribute("height", String(height));
  }

  updateGraphEdges(positions) {
    for (const edge of this.graphEdges || []) {
      const from = positions.get(edge.dataset.parent); const to = positions.get(edge.dataset.child);
      if (!from || !to) continue;
      const distance = Math.max(1, to.x - from.x);
      const bend = Math.max(18, distance * .42);
      edge.setAttribute("d", `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`);
    }
  }

  applyGraphFrame(positions, labelled) {
    for (const [id, element] of this.graphNodes || []) {
      const point = positions.get(id); if (!point) continue;
      const size = this.graphNodeSize(id, labelled);
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
      element.style.width = `${size.width}px`;
      element.style.height = `${size.height}px`;
    }
    this.updateGraphEdges(positions);
    this.graphCurrentPositions = new Map([...positions].map(([id, point]) => [id, { ...point }]));
  }

  animateGraphTo(target, labelled, duration = 180) {
    if (!this.graphPlaneEl) return;
    if (this.graphAnimationFrame) window.cancelAnimationFrame(this.graphAnimationFrame);
    this.graphTargetPositions = new Map([...target].map(([id, point]) => [id, { ...point }]));
    this.graphTargetLabels = new Set(labelled);
    const start = new Map([...(this.graphCurrentPositions || this.graphBasePositions)].map(([id, point]) => [id, { ...point }]));
    const maxX = this.graphExpanded
      ? this.graphLayoutWidth
      : Math.max(this.graphLayoutWidth, ...[...target].map(([id, point]) => point.x + this.graphNodeSize(id, labelled).width / 2 + 20));
    const maxY = this.graphExpanded
      ? this.graphLayoutHeight
      : Math.max(this.graphLayoutHeight, ...[...target].map(([id, point]) => point.y + this.graphNodeSize(id, labelled).height / 2 + 20));
    const currentWidth = Number.parseFloat(this.graphPlaneEl.style.width) || this.graphLayoutWidth;
    const currentHeight = Number.parseFloat(this.graphPlaneEl.style.height) || this.graphLayoutHeight;
    this.setGraphSurface(Math.max(currentWidth, maxX), Math.max(currentHeight, maxY));
    const started = performance.now();
    const tick = (time) => {
      const raw = Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      const frame = new Map();
      for (const [id, destination] of target) {
        const origin = start.get(id) || destination;
        frame.set(id, {
          x: origin.x + (destination.x - origin.x) * eased,
          y: origin.y + (destination.y - origin.y) * eased,
        });
      }
      this.applyGraphFrame(frame, labelled);
      if (raw < 1) this.graphAnimationFrame = window.requestAnimationFrame(tick);
      else {
        this.graphAnimationFrame = null;
        this.setGraphSurface(maxX, maxY);
      }
    };
    this.graphAnimationFrame = window.requestAnimationFrame(tick);
  }

  reflowGraph(focus, anchorId = "") {
    if (!this.graphBasePositions) return;
    const labelled = this.graphExpanded ? new Set(this.plugin.index.nodes.map((node) => node.id)) : focus;
    const positions = this.graphExpanded || !focus.size ? this.graphBasePositions : this.graphPositionsForFocus(focus, anchorId);
    for (const [id, element] of this.graphNodes || []) element.toggleClass("is-labelled", labelled.has(id));
    this.animateGraphTo(positions, labelled);
  }

  highlightQuantum(id, persist = false) {
    if (!id || !this.graphCanvasEl) return;
    const focus = this.plugin.index.scope(id);
    this.graphCanvasEl.addClass("has-highlight");
    for (const [nodeId, element] of this.graphNodes || []) element.toggleClass("is-highlighted", focus.has(nodeId));
    for (const edge of this.graphEdges || []) edge.classList.toggle("is-highlighted", focus.has(edge.dataset.parent) && focus.has(edge.dataset.child));
    this.rootEl.querySelectorAll("[data-quantum-id]").forEach((element) => {
      if (!element.classList.contains("sb-graph-node")) element.classList.toggle("sb-external-highlight", focus.has(element.dataset.quantumId));
    });
    const record = this.plugin.index.byId.get(id);
    if (this.graphStateEl) this.graphStateEl.setText(`${record?.title || id} · выделено ${focus.size} квантов`);
    this.reflowGraph(focus, id);
    if (persist) this.persistentHighlight = id;
  }

  clearHighlight() {
    if (this.persistentHighlight) {
      this.highlightQuantum(this.persistentHighlight, false);
      return;
    }
    this.graphCanvasEl?.removeClass("has-highlight");
    for (const element of this.graphNodes?.values() || []) element.removeClass("is-highlighted");
    for (const edge of this.graphEdges || []) edge.classList.remove("is-highlighted");
    this.rootEl.querySelectorAll(".sb-external-highlight").forEach((element) => element.removeClass("sb-external-highlight"));
    if (this.graphStateEl) {
      this.graphStateEl.setText(this.graphExpanded
        ? `${this.plugin.index.nodes.length} квантов · все названия показаны`
        : `${this.plugin.index.nodes.length} квантов · наведите, чтобы раскрыть ветку`);
    }
    this.reflowGraph(new Set());
  }

  clearPinnedQuantum() {
    this.persistentHighlight = null;
    this.selectedTaskId = "";
    this.contextPinned = false;
    this.contextSlotEl?.removeClass("is-pinned");
    this.contextSlotEl?.removeClass("is-visible");
    this.clearHighlight();
    void this.plugin.rememberQuantum("");
    new Notice("Выделение снято");
  }

  async openRecord(record, separateTab = false) {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(separateTab ? "tab" : true).openFile(file);
  }
}

module.exports = class SecondBrainCorePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({ taskFolder: "10 University/Задания", deadlineFolder: "10 University/Дедлайны", contentRoots: ["10 University"], semesterStart: "2026-08-31", defaultView: "calendar", openOnStartup: true }, await this.loadData());
    this.index = new BrainIndex(this.app, this.settings);
    await this.index.rebuild();
    this.registerView(VIEW_TYPE, (leaf) => new SecondBrainView(leaf, this));
    this.addRibbonIcon("calendar-range", "Открыть Second Brain", () => this.activateView());
    this.addCommand({ id: "open-second-brain", name: "Открыть Second Brain", callback: () => this.activateView() });
    this.addCommand({ id: "create-task", name: "Создать задание", callback: () => new NewTaskModal(this.app, this).open() });
    this.addCommand({ id: "create-deadline", name: "Создать дедлайн", callback: () => new NewDeadlineModal(this.app, this).open() });
    this.addCommand({ id: "rebuild-index", name: "Перестроить индекс", callback: async () => { await this.refreshViews(); new Notice("Индекс Second Brain обновлён"); } });
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup && !this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
    });
    const schedule = () => this.scheduleRefresh();
    this.registerEvent(this.app.metadataCache.on("changed", schedule));
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    window.clearTimeout(this.refreshTimer);
  }

  scheduleRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshViews(), 180);
  }

  async rememberQuantum(id) {
    const value = id || "";
    if (this.settings.lastSelectedQuantum === value) return;
    this.settings.lastSelectedQuantum = value;
    await this.saveData(this.settings);
  }

  async refreshViews() {
    await this.index.rebuild();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof SecondBrainView) await leaf.view.refresh();
    }
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async ensureFolder(path) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async createTask(data) {
    await this.ensureFolder(this.settings.taskFolder);
    const selected = this.index.byId.get(data.quantum);
    const subject = this.index.subjectFor(selected);
    const base = slugify(data.title);
    let path = `${this.settings.taskFolder}/${base}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${this.settings.taskFolder}/${base}-${suffix}.md`;
      suffix += 1;
    }
    const id = `task-${Date.now().toString(36)}`;
    const markdown = `---\nsb-type: task\nsb-id: ${id}\nsb-parent: ${data.quantum}\nsb-quant: ${data.quantum}\nsb-subject: ${subject?.id || ""}\ntitle: "${data.title.replace(/"/g, "\\\"")}"\ndue: ${dateKey(data.due) || new Date().toISOString().slice(0, 10)}\nstatus: todo\nprogress: 0\ngraph: true\nsummary: ""\n---\n\n# ${data.title}\n\n## Результат\n\n- [ ] Определить критерий готовности\n\n## Процесс\n\n- [ ] Разобрать условие\n- [ ] Подготовить черновик\n- [ ] Проверить и сдать\n`;
    const file = await this.app.vault.create(path, markdown);
    new Notice(`Создано задание: ${data.title}`);
    await this.refreshViews();
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async createDeadline(data) {
    await this.ensureFolder(this.settings.deadlineFolder);
    const selected = this.index.byId.get(data.quantum);
    const subject = this.index.subjectFor(selected);
    const base = slugify(data.title);
    let path = `${this.settings.deadlineFolder}/${base}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${this.settings.deadlineFolder}/${base}-${suffix}.md`;
      suffix += 1;
    }
    const id = `deadline-${Date.now().toString(36)}`;
    const stages = data.stages.map((stage) => {
      const anchor = this.index.byId.get(stage.anchor);
      return {
        title: stage.title.trim(),
        due: dateKey(stage.due) || anchor?.date || localDateKey(new Date()),
        time: stage.time || anchor?.time || "",
        anchor: anchor?.id || "",
        anchorRecord: anchor,
      };
    });
    const stageYaml = stages.flatMap((stage) => [
      `  - date: ${stage.due}`,
      ...(stage.title ? [`    title: ${yamlQuote(stage.title)}`] : []),
      ...(stage.time ? [`    time: ${yamlQuote(stage.time)}`] : []),
      ...(stage.anchor ? [`    anchor: ${yamlQuote(stage.anchor)}`] : []),
    ]).join("\n");
    const stageMarkdown = stages.map((stage) => {
      const anchorLink = stage.anchorRecord ? ` → [[${stage.anchorRecord.path}|${stage.anchorRecord.title}]]` : "";
      return `- [ ] ${stage.due}${stage.time ? ` ${stage.time}` : ""}${stage.title ? ` — ${stage.title}` : ""}${anchorLink}`;
    }).join("\n");
    const markdown = `---\nsb-type: deadline\nsb-id: ${yamlQuote(id)}\nsb-parent: ${yamlQuote(data.quantum)}\nsb-quant: ${yamlQuote(data.quantum)}\nsb-subject: ${yamlQuote(subject?.id || "")}\ntitle: ${yamlQuote(data.title.trim())}\nstatus: todo\nprogress: 0\ngraph: false\n${data.showFrom ? `show-from: ${dateKey(data.showFrom)}\n` : ""}deadlines:\n${stageYaml}\nsummary: ${yamlQuote("Многоэтапный дедлайн. Ближайшая дата выбирается автоматически, остальные сохраняются в карточке.")}\ntags:\n  - deadline\n---\n\n# ${data.title.trim()}\n\n## Тема\n\n[[${selected?.path || "00 System/Second Brain"}|${selected?.title || data.quantum}]]\n\n## Сроки\n\n${stageMarkdown}\n\n## Результат\n\n- [ ] Определить критерий готовности\n\n## Процесс\n\n- [ ] Подготовить\n- [ ] Проверить\n- [ ] Сдать\n`;
    const file = await this.app.vault.create(path, markdown);
    new Notice(`Создан дедлайн: ${data.title}`);
    await this.refreshViews();
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async setRecordCompletion(record, completed) {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) {
      new Notice("Не удалось найти файл");
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (completed) {
        const currentProgress = Math.max(0, Math.min(100, safeNumber(frontmatter.progress, record.progress || 0)));
        if (currentProgress < 100) frontmatter["progress-before-done"] = currentProgress;
        const currentStatus = asString(frontmatter.status || record.status || "todo");
        if (!["done", "completed", "complete", "выполнено", "готово"].includes(currentStatus.toLocaleLowerCase("ru"))) {
          frontmatter["status-before-done"] = currentStatus;
        }
        frontmatter.status = "done";
        frontmatter.progress = 100;
        frontmatter["completed-at"] = localDateKey(new Date());
      } else {
        frontmatter.status = asString(frontmatter["status-before-done"] || "todo");
        frontmatter.progress = Math.max(0, Math.min(99, safeNumber(frontmatter["progress-before-done"], 0)));
        delete frontmatter["status-before-done"];
        delete frontmatter["progress-before-done"];
        delete frontmatter["completed-at"];
      }
    });
    new Notice(completed ? "Отмечено как выполненное" : "Работа возобновлена");
    await this.refreshViews();
  }

  async deleteRecord(record) {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) {
      new Notice("Файл уже удалён или перемещён");
      return;
    }
    try {
      await this.app.vault.trash(file, true);
    } catch (error) {
      await this.app.vault.trash(file, false);
    }
    new Notice(`Перемещено в корзину: ${record.title}`);
    await this.refreshViews();
  }

  async setDeadlineShowFrom(record, showFrom) {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) {
      new Notice("Не удалось найти файл дедлайна");
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (showFrom) frontmatter["show-from"] = dateKey(showFrom);
      else delete frontmatter["show-from"];
    });
    new Notice(showFrom ? `Дедлайн скрыт до ${formatDate(showFrom)}` : "Дедлайн снова отображается постоянно");
    await this.refreshViews();
  }
};

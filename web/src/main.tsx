import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  ImagePlus,
  Images,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { api, setToken } from "./api";
import { prepare, preparedName } from "./image";
import { PhoneDialog } from "./PhoneDialog";
import { PhonePage } from "./PhonePage";
import "./style.css";
import "./phone.css";

type Permissions = { view_photos: boolean; manage_photos: boolean };
type Frame = {
  peer_id: string;
  name: string;
  placement: string;
  width: number;
  height: number;
  host: string;
  port: number;
  protocol_version: number;
  permissions: Permissions;
};
type Media = {
  id: string;
  type: string;
  visible: boolean;
  captured: number;
  received: number;
};
type Service = {
  instance: string;
  host: string;
  port: number;
  hostname: string;
};
type Job = {
  id: string;
  kind: string;
  peer: string;
  label: string;
  state: string;
  progress: number;
  message?: string;
  error?: string;
};
const date = (value: number) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Date unavailable";
const imageURL = (peer: string, id: string, full = false) =>
  `/api/frames/${peer}/media/${id}${full ? "?full=1" : ""}`;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function PairDialog({
  close,
  name,
  added,
}: {
  close: () => void;
  name: string;
  added: (job: Job) => void;
}) {
  const [services, setServices] = useState<Service[]>([]),
    [scanning, setScanning] = useState(true),
    [selected, setSelected] = useState<Service | null>(null);
  const [manual, setManual] = useState(false),
    [host, setHost] = useState(""),
    [port, setPort] = useState(""),
    [code, setCode] = useState(""),
    [sender, setSender] = useState(name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const scan = async () => {
    setScanning(true);
    setError("");
    try {
      setServices(await api<Service[]>("/discover"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setScanning(false);
    }
  };
  useEffect(() => {
    void scan();
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const service = manual
        ? { instance: "", hostname: "", host, port: Number(port) }
        : selected;
      if (!service) throw new Error("Choose a frame first.");
      const job = await api<Job>("/pair", { service, code, name: sender });
      added(job);
      close();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Connect a frame" close={close}>
      <p className="muted">
        A little closer to the people and photos you love.
      </p>
      <form onSubmit={submit}>
        <div className="step-label">
          <span>1</span> Find your frame{" "}
          <button
            type="button"
            className="text-button push-right"
            onClick={scan}
            disabled={scanning}
          >
            <RefreshCw size={14} className={scanning ? "spin" : ""} /> Scan
            again
          </button>
        </div>
        {scanning ? (
          <div className="scan-state">
            <LoaderCircle className="spin" size={20} /> Looking on your local
            network…
          </div>
        ) : (
          !manual && (
            <div className="service-list">
              {services.length === 0 ? (
                <p className="muted">
                  No frames found. Check that your frame and computer are on the
                  same Wi-Fi.
                </p>
              ) : (
                services.map((s) => (
                  <button
                    type="button"
                    key={s.instance}
                    className={`service ${selected?.instance === s.instance ? "chosen" : ""}`}
                    onClick={() => setSelected(s)}
                  >
                    <span className="device-icon">
                      <Monitor size={22} />
                    </span>
                    <span>
                      <strong>
                        {s.hostname.replace(/\.local\.$/, "") || "Frameo frame"}
                      </strong>
                      <small>
                        {s.host} · {s.port}
                      </small>
                    </span>
                    {selected?.instance === s.instance && (
                      <Check size={18} className="push-right" />
                    )}
                  </button>
                ))
              )}
            </div>
          )
        )}
        <button
          type="button"
          className="text-button manual-toggle"
          onClick={() => setManual(!manual)}
        >
          {manual ? "Use discovered frames" : "Enter an address manually"}
        </button>
        {manual && (
          <div className="two-fields">
            <label>
              Address
              <input
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
              />
            </label>
            <label>
              Port
              <input
                required
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="step-label">
          <span>2</span> Enter its friend code
        </div>
        <p className="field-help">
          On your frame, tap <strong>Add friend</strong> to get a code.
        </p>
        <input
          aria-label="Friend code"
          className="code-input"
          inputMode="numeric"
          autoComplete="off"
          placeholder="00 00 00 00 00"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={30}
        />
        <label className="sender-label">
          Your name on the frame
          <input
            required
            maxLength={100}
            value={sender}
            onChange={(e) => setSender(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-inline" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <span className="quiet">
            <ShieldCheck size={15} /> Encrypted, directly to your frame
          </span>
          <button className="primary" disabled={busy || (!selected && !manual)}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}{" "}
            Connect frame
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UploadDialog({
  frame,
  close,
  added,
  phone,
}: {
  frame: Frame;
  close: () => void;
  added: (job: Job) => void;
  phone: () => void;
}) {
  const [photos, setPhotos] = useState<File[]>([]),
    [caption, setCaption] = useState(""),
    [fit, setFit] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [phase, setPhase] = useState("");
  const input = useRef<HTMLInputElement>(null),
    stop = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const add = (files: FileList | null) => {
    if (files) setPhotos((p) => [...p, ...Array.from(files)].slice(0, 100));
  };
  const send = async () => {
    setBusy(true);
    setError("");
    let completed = 0;
    try {
      for (const [index, file] of photos.entries()) {
        if (stop.current) return;
        setPhase(`Preparing ${index + 1} of ${photos.length}…`);
        const data = await prepare(file, frame);
        if (stop.current) return;
        const form = new FormData();
        form.append("photo", data, preparedName(file, data));
        form.append("caption", caption);
        form.append("fit", String(fit));
        form.append("captured", String(file.lastModified));
        const job = await api<Job>(`/frames/${frame.peer_id}/upload`, form);
        added(job);
        setPhase(`Sending ${index + 1} of ${photos.length}…`);
        // Keep one photo in flight: bounded memory, predictable order, real receipts.
        while (!stop.current) {
          await new Promise((r) => setTimeout(r, 700));
          const all = await api<Job[]>("/jobs");
          const current = all.find((j) => j.id === job.id);
          if (current?.state === "succeeded") break;
          if (current && current.state !== "running")
            throw new Error(current.error || "Transfer cancelled.");
        }
        completed++;
      }
      close();
    } catch (e) {
      setPhotos((p) => p.slice(completed));
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Send photos to ${frame.name}`}
      close={() => {
        stop.current = true;
        close();
      }}
    >
      <p className="muted">Choose a few moments to brighten the frame.</p>
      {!busy && (
        <button className="phone-upload-alternative" onClick={phone}>
          <Smartphone size={17} />
          <span>Photos on your phone?</span> Scan a code{" "}
          <ArrowUpRight size={14} />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        disabled={busy}
        className="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) add(e.dataTransfer.files);
        }}
      >
        <span className="upload-symbol">
          <ImagePlus size={28} />
        </span>
        <strong>Drop your photos here</strong>
        <span>or click to choose files</span>
        <small>JPEG, PNG and WebP · up to 100 photos</small>
      </button>
      {photos.length > 0 && (
        <div className="chosen-files">
          <strong>
            {photos.length} {photos.length === 1 ? "photo" : "photos"} selected
          </strong>
          <span>{photos.map((p) => p.name).join(", ")}</span>
          {!busy && (
            <button className="text-button" onClick={() => setPhotos([])}>
              Clear
            </button>
          )}
        </div>
      )}
      <label>
        Caption <span className="optional">optional</span>
        <textarea
          value={caption}
          disabled={busy}
          maxLength={500}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="A little story behind these moments…"
          rows={2}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={fit}
          disabled={busy}
          onChange={(e) => setFit(e.target.checked)}
        />
        <span>
          Show the whole photo
          <small>Turn off to fill the frame with a centered crop.</small>
        </span>
      </label>
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <span className="quiet">
          {busy ? phase : "Your original files stay untouched."}
        </span>
        <button
          className="primary"
          disabled={busy || !photos.length}
          onClick={send}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Upload size={16} />
          )}{" "}
          {busy ? "Sending…" : "Send photos"}
        </button>
      </div>
    </Modal>
  );
}

function PhotoCard({
  item,
  peer,
  selected,
  select,
  open,
}: {
  item: Media;
  peer: string;
  selected: boolean;
  select: () => void;
  open: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <article className={`photo-card ${selected ? "selected" : ""}`}>
      <div className="photo-wrap">
        <button
          className="photo-open"
          onClick={open}
          aria-label={`Open photo from ${date(item.received)}`}
        >
          {failed ? (
            <span className="image-failed">
              <Images size={26} />
              <span>Preview unavailable</span>
            </span>
          ) : (
            <img
              src={imageURL(peer, item.id)}
              loading="lazy"
              alt={`Frame ${item.type} received ${date(item.received)}`}
              onError={() => setFailed(true)}
            />
          )}
        </button>
        <button
          className={`select-photo ${selected ? "checked" : ""}`}
          onClick={select}
          aria-label={`${selected ? "Deselect" : "Select"} photo ${item.id}`}
          aria-pressed={selected}
        >
          {selected && <Check size={14} />}
        </button>
        {!item.visible && (
          <span className="hidden-badge">
            <EyeOff size={12} /> Hidden
          </span>
        )}
        {item.type !== "photo" && (
          <span className="media-type">{item.type}</span>
        )}
        <button
          className="photo-more"
          onClick={open}
          aria-label="Photo details"
        >
          <MoreHorizontal size={19} />
        </button>
      </div>
      <div className="photo-caption">
        <span>{date(item.received)}</span>
        <span className="quiet">
          {item.visible ? "In slideshow" : "Not in slideshow"}
        </span>
      </div>
    </article>
  );
}

function ActivityControl({
  jobs,
  open,
  setOpen,
  onError,
}: {
  jobs: Job[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const running = jobs.filter((job) => job.state === "running").length;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      setOpen(false);
      ref.current
        ?.querySelector<HTMLButtonElement>(".activity-toggle")
        ?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);
  return (
    <div className="activity-anchor" ref={ref}>
      <button
        className={`activity-toggle ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="activity-panel"
      >
        <Upload size={16} />
        <span>Activity</span>
        {running > 0 && <span className="count-dot">{running}</span>}
      </button>
      {open && (
        <aside
          className="activity-panel"
          id="activity-panel"
          aria-label="Recent activity"
        >
          <div className="panel-heading">
            <h2>Activity</h2>
            <button
              className="icon-button"
              aria-label="Close activity"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p className="muted">Transfers and frame changes.</p>
          {jobs.length === 0 ? (
            <div className="activity-empty">
              <CheckCircle2 size={30} />
              <p>No recent activity.</p>
            </div>
          ) : (
            [...jobs].reverse().map((job) => (
              <div className={`job ${job.state}`} key={job.id}>
                <div className="job-title">
                  {job.state === "running" ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : job.state === "succeeded" ? (
                    <CheckCircle2 size={17} />
                  ) : (
                    <X size={17} />
                  )}
                  <strong>{job.label}</strong>
                </div>
                <p>
                  {job.error ||
                    (job.state === "succeeded"
                      ? job.kind === "upload"
                        ? "Received by your frame"
                        : job.message || "Done"
                      : job.state === "cancelled"
                        ? "Cancelled"
                        : job.message || "Getting ready…")}
                </p>
                {job.state === "running" && (
                  <>
                    <progress max={1} value={job.progress} />
                    <button
                      className="text-button"
                      onClick={() =>
                        api(`/jobs/${job.id}`, {}, "DELETE").catch((e) =>
                          onError(errorText(e)),
                        )
                      }
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </aside>
      )}
    </div>
  );
}

function App() {
  const [frames, setFrames] = useState<Frame[]>([]),
    [peer, setPeer] = useState(""),
    [name, setName] = useState("My computer"),
    [items, setItems] = useState<Media[]>([]);
  const [starting, setStarting] = useState(true),
    [loading, setLoading] = useState(false),
    [online, setOnline] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [jobs, setJobs] = useState<Job[]>([]);
  const [dialog, setDialog] = useState<
      "pair" | "upload" | "phone" | "access" | "delete" | "settings" | null
    >(null),
    [detail, setDetail] = useState<Media | null>(null),
    [activity, setActivity] = useState(false);
  const doneJobs = useRef(new Set<string>()),
    firstJobsSnapshot = useRef(true),
    loadSeq = useRef(0),
    peerRef = useRef(peer);
  const frame = frames.find((f) => f.peer_id === peer);
  const running = jobs.filter((j) => j.state === "running"),
    permissionPending = running.some(
      (j) => j.kind === "permission" && j.peer === peer,
    );
  useEffect(() => {
    peerRef.current = peer;
  }, [peer]);
  useEffect(() => {
    api<{ token: string; name: string; frames: Frame[] }>("/bootstrap")
      .then((data) => {
        setToken(data.token);
        setName(data.name);
        setFrames(data.frames);
        setPeer(data.frames[0]?.peer_id || "");
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setStarting(false));
  }, []);
  const reload = useCallback(async (id: string) => {
    if (!id) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const info = await api<Omit<Frame, "peer_id">>(`/frames/${id}/info`);
      if (seq !== loadSeq.current) return;
      setOnline(true);
      setFrames((fs) =>
        fs.map((f) => (f.peer_id === id ? { ...f, ...info } : f)),
      );
      if (info.permissions.view_photos) {
        const media = await api<Media[]>(`/frames/${id}/media`);
        if (seq === loadSeq.current) setItems(media);
      } else setItems([]);
    } catch (e) {
      if (seq === loadSeq.current) {
        setError(errorText(e));
        setOnline(false);
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setItems([]);
    setSelected(new Set());
    setDetail(null);
    setOnline(false);
    void reload(peer);
    return () => {
      loadSeq.current++;
    };
  }, [peer, reload]);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const list = await api<Job[]>("/jobs");
        if (!active) return;
        setJobs(list);
        // Keep history in Activity without announcing past transfers on reload.
        if (firstJobsSnapshot.current) {
          firstJobsSnapshot.current = false;
          for (const job of list) {
            if (job.state !== "running") doneJobs.current.add(job.id);
          }
        }
        for (const job of list) {
          if (job.state === "running" || doneJobs.current.has(job.id)) continue;
          doneJobs.current.add(job.id);
          if (job.state === "succeeded") {
            if (job.kind === "pair") {
              const fs = await api<Frame[]>("/frames");
              if (!active) return;
              setFrames(fs);
              const added = fs.find(
                (f) => !frames.some((old) => old.peer_id === f.peer_id),
              );
              if (added) setPeer(added.peer_id);
              setNotice("Frame connected. You’re ready to send photos.");
            } else {
              setNotice(
                job.kind === "upload"
                  ? `${job.label} arrived on your frame.`
                  : job.kind === "permission"
                    ? "Photo access granted. Welcome to your gallery."
                    : job.message || "Your frame has been updated.",
              );
              if (job.peer === peerRef.current) void reload(job.peer);
            }
          } else if (job.state === "failed") {
            setError(job.error || "The operation failed.");
            setActivity(true);
          }
        }
      } catch {
        /* A temporary polling error should not interrupt the gallery. */
      }
    };
    const timer = setInterval(tick, 1000);
    void tick();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [reload, frames.length]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const added = (j: Job) => {
    setJobs((js) => [...js.filter((x) => x.id !== j.id), j]);
    setActivity(true);
  };
  const requestAccess = async () => {
    setDialog(null);
    try {
      added(await api<Job>(`/frames/${peer}/permissions`, { manage: true }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const action = async (verb: string, ids = [...selected]) => {
    if (!ids.length) return;
    try {
      added(await api<Job>(`/frames/${peer}/actions`, { action: verb, ids }));
      setSelected(new Set());
      setDetail(null);
      setDialog(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const filtered = items.filter(
    (x) =>
      (filter === "all" || (filter === "visible" ? x.visible : !x.visible)) &&
      (!query ||
        `${date(x.received)} ${date(x.captured)} ${x.type} ${x.id}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const visibleCount = items.filter((i) => i.visible).length;
  const activityControl = (
    <ActivityControl
      jobs={jobs}
      open={activity}
      setOpen={setActivity}
      onError={setError}
    />
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Frameo Local home">
          <span className="brand-icon">
            <Images size={22} />
          </span>
          <span>
            frameo<span className="brand-local">local</span>
          </span>
        </a>
        <div className="sidebar-label">YOUR FRAMES</div>
        <nav aria-label="Frames">
          {frames.map((f) => (
            <button
              key={f.peer_id}
              className={`frame-nav ${f.peer_id === peer ? "active" : ""}`}
              onClick={() => setPeer(f.peer_id)}
              aria-current={f.peer_id === peer ? "page" : undefined}
            >
              <span className="frame-nav-icon">
                <Monitor size={20} />
              </span>
              <span className="frame-nav-copy">
                <strong>{f.name || "Frameo frame"}</strong>
                <small>{f.placement || "Your photo frame"}</small>
              </span>
              {f.peer_id === peer && online && <span className="status-dot" />}
            </button>
          ))}
          {frames.length > 0 && (
            <button className="add-frame" onClick={() => setDialog("pair")}>
              <span className="nav-action-icon">
                <Plus size={18} />
              </span>{" "}
              Connect a frame
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-settings"
            onClick={() => setDialog("settings")}
            aria-label="Connection details"
          >
            <span className="nav-action-icon">
              <Settings2 size={18} />
            </span>
            <span className="sidebar-settings-label">Connection details</span>
          </button>
        </div>
      </aside>
      <main className="main">
        {!frame && <div className="welcome-actions">{activityControl}</div>}
        {error && (
          <div className="notice error" role="alert">
            <span>{error}</span>
            <button
              aria-label="Dismiss error"
              className="icon-button"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice success" role="status">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              className="icon-button"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {starting ? (
          <section className="empty">
            <LoaderCircle className="spin" size={30} />
            <p>Opening your frames…</p>
          </section>
        ) : !frame ? (
          <section className="welcome">
            <div className="welcome-art">
              <div className="mini-frame">
                <Images size={64} />
              </div>
              <span className="art-dot one" />
              <span className="art-dot two" />
            </div>
            <span className="eyebrow">A HOME FOR YOUR MOMENTS</span>
            <h1>
              Your photos.
              <br />A little closer.
            </h1>
            <p>
              Connect your Frameo frame to send, browse and
              <br className="desktop-break" /> make room for the moments that
              matter.
            </p>
            <button className="primary" onClick={() => setDialog("pair")}>
              <Plus size={18} /> Connect your first frame
            </button>
            <div className="welcome-foot">
              <Wifi size={15} /> Keep your computer and frame on the same Wi-Fi.
            </div>
          </section>
        ) : (
          <>
            <section className="gallery-heading">
              <div>
                <div className="eyebrow">
                  {frame.placement || "YOUR PHOTO FRAME"}
                </div>
                <h1>
                  <span className="frame-name">{frame.name}</span>
                  <span className={`online-pill ${online ? "" : "offline"}`}>
                    <span className="status-dot" />
                    {loading && !online
                      ? "Connecting"
                      : online
                        ? "Connected"
                        : "Offline"}
                  </span>
                </h1>
              </div>
              <div className="gallery-actions">
                {activityControl}
                <button
                  className="secondary from-phone"
                  disabled={!online}
                  onClick={() => setDialog("phone")}
                  aria-label="Add from phone"
                >
                  <Smartphone size={17} />
                  <span>From phone</span>
                </button>
                <button
                  className="primary"
                  disabled={!online}
                  onClick={() => setDialog("upload")}
                >
                  <Plus size={18} /> Add photos
                </button>
              </div>
            </section>
            {!frame.permissions.view_photos ? (
              <section className="permission-panel">
                <span className="permission-art">
                  <Images size={36} />
                  <ShieldCheck size={21} />
                </span>
                <h2>Bring your frame’s gallery into view</h2>
                <p>
                  You can already send photos. To browse, hide or delete them,
                  <br className="desktop-break" /> ask your frame for photo
                  access.
                </p>
                <button
                  className="primary"
                  disabled={!online || permissionPending}
                  onClick={() => setDialog("access")}
                >
                  {permissionPending ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}{" "}
                  {permissionPending
                    ? "Waiting for approval…"
                    : "Request photo access"}
                </button>
                <small>Someone at the frame will need to press Allow.</small>
              </section>
            ) : (
              <>
                {!frame.permissions.manage_photos && (
                  <div className="view-only">
                    <ShieldCheck size={18} />
                    <span>
                      You have viewing access. Request management access to hide
                      or delete photos.
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setDialog("access")}
                      disabled={permissionPending}
                    >
                      Request access <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
                <div className="gallery-toolbar">
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="Photo visibility"
                  >
                    {[
                      ["all", "All photos", items.length],
                      ["visible", "In slideshow", visibleCount],
                      ["hidden", "Hidden", items.length - visibleCount],
                    ].map(([value, label, count]) => (
                      <button
                        role="tab"
                        aria-selected={filter === value}
                        key={value}
                        className={filter === value ? "active" : ""}
                        onClick={() => setFilter(String(value))}
                      >
                        {label}
                        <span>{count}</span>
                      </button>
                    ))}
                  </div>
                  <div className="toolbar-right">
                    <label className="search">
                      <Search size={16} />
                      <input
                        type="search"
                        aria-label="Search photos"
                        placeholder="Find a date or photo…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <button
                      className="icon-button"
                      onClick={() => reload(peer)}
                      disabled={loading || permissionPending}
                      aria-label="Refresh gallery"
                    >
                      <RefreshCw size={17} className={loading ? "spin" : ""} />
                    </button>
                  </div>
                </div>
                <div className="gallery-subtitle">
                  <span>
                    {loading
                      ? "Refreshing your gallery…"
                      : `${filtered.length} ${filtered.length === 1 ? "photo" : "photos"}`}
                  </span>
                  <button
                    className="text-button"
                    disabled={!filtered.length}
                    onClick={() =>
                      setSelected(
                        selected.size
                          ? new Set()
                          : new Set(filtered.map((x) => x.id)),
                      )
                    }
                  >
                    {selected.size ? "Clear selection" : "Select all"}
                  </button>
                </div>
                {loading && !items.length ? (
                  <div className="photo-grid skeletons">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div key={i} className="skeleton" />
                    ))}
                  </div>
                ) : filtered.length ? (
                  <div className="photo-grid">
                    {filtered.map((item) => (
                      <PhotoCard
                        key={`${peer}:${item.id}`}
                        item={item}
                        peer={peer}
                        selected={selected.has(item.id)}
                        select={() => toggle(item.id)}
                        open={() => setDetail(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <section className="empty">
                    <Images size={38} />
                    <h2>
                      {query
                        ? "No matching moments"
                        : filter === "hidden"
                          ? "Nothing tucked away"
                          : "Room for something wonderful"}
                    </h2>
                    <p>
                      {query
                        ? "Try another date or photo ID."
                        : filter === "hidden"
                          ? "Photos you hide will appear here."
                          : "Add a few photos to make this frame feel like home."}
                    </p>
                    {!query && filter !== "hidden" && (
                      <button
                        className="secondary"
                        onClick={() => setDialog("upload")}
                      >
                        <Plus size={16} /> Add photos
                      </button>
                    )}
                  </section>
                )}
                {selected.size > 0 && (
                  <div className="selection-bar">
                    <button
                      className="icon-button"
                      aria-label="Clear selection"
                      onClick={() => setSelected(new Set())}
                    >
                      <X size={17} />
                    </button>
                    <strong>{selected.size} selected</strong>
                    <span className="selection-spacer" />
                    {selected.size === 1 && (
                      <>
                        <button
                          onClick={() =>
                            window.open(
                              imageURL(peer, [...selected][0], true) +
                                "&download=1",
                              "_blank",
                            )
                          }
                        >
                          <ArrowDownToLine size={16} /> Download
                        </button>
                        <button
                          disabled={!frame.permissions.manage_photos}
                          onClick={() => action("display")}
                        >
                          <Monitor size={16} /> Display
                        </button>
                      </>
                    )}
                    <button
                      disabled={!frame.permissions.manage_photos}
                      onClick={() => action("hide")}
                    >
                      <EyeOff size={16} /> Hide
                    </button>
                    <button
                      disabled={!frame.permissions.manage_photos}
                      onClick={() => action("show")}
                    >
                      <Eye size={16} /> Show
                    </button>
                    <button
                      className="danger-text"
                      disabled={!frame.permissions.manage_photos}
                      onClick={() => setDialog("delete")}
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
      {dialog === "pair" && (
        <PairDialog close={() => setDialog(null)} name={name} added={added} />
      )}
      {dialog === "upload" && frame && (
        <UploadDialog
          frame={frame}
          close={() => setDialog(null)}
          added={added}
          phone={() => setDialog("phone")}
        />
      )}
      {dialog === "phone" && frame && (
        <PhoneDialog frame={frame} close={() => setDialog(null)} />
      )}
      {dialog === "access" && frame && (
        <Modal
          title="A little permission, on your frame"
          close={() => setDialog(null)}
        >
          <div className="access-illustration">
            <Monitor size={48} />
            <ShieldCheck size={24} />
          </div>
          <p>
            We’ll ask <strong>{frame.name}</strong> to let this computer see and
            manage its photos.
          </p>
          <div className="access-features">
            <span>
              <Check size={16} /> Browse and download photos
            </span>
            <span>
              <Check size={16} /> Show, hide and delete selected photos
            </span>
          </div>
          <p className="muted">
            When the request appears, press <strong>Allow</strong> on the frame.
            You can continue sending photos without granting gallery access.
          </p>
          <div className="modal-footer">
            <button className="text-button" onClick={() => setDialog(null)}>
              Not now
            </button>
            <button className="primary" onClick={requestAccess}>
              Send request <ArrowUpRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal
          title={`Delete ${selected.size} ${selected.size === 1 ? "photo" : "photos"}?`}
          close={() => setDialog(null)}
        >
          <p>
            This removes the selected photos from <strong>{frame?.name}</strong>
            . It can’t be undone here.
          </p>
          <p className="muted">
            Want to keep them for later? Hide them from the slideshow instead.
          </p>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setDialog(null)}>
              Keep photos
            </button>
            <button className="danger" onClick={() => action("delete")}>
              <Trash2 size={16} /> Delete from frame
            </button>
          </div>
        </Modal>
      )}
      {dialog === "settings" && (
        <Modal title="Connection details" close={() => setDialog(null)}>
          <p className="muted">
            Your pairing stays on this computer. Photos travel directly over
            your local network.
          </p>
          <dl className="details">
            <dt>Sender</dt>
            <dd>{name}</dd>
            {frame && (
              <>
                <dt>Frame</dt>
                <dd>
                  {frame.name} · {frame.placement}
                </dd>
                <dt>Address</dt>
                <dd>
                  {frame.host}:{frame.port}
                </dd>
                <dt>Protocol</dt>
                <dd>{frame.protocol_version}</dd>
                <dt>Display</dt>
                <dd>
                  {frame.width} × {frame.height}
                </dd>
                <dt>Photo access</dt>
                <dd>
                  {frame.permissions.manage_photos
                    ? "View and manage"
                    : frame.permissions.view_photos
                      ? "View only"
                      : "Send only"}
                </dd>
                <dt>Frame identity</dt>
                <dd className="mono">{frame.peer_id}</dd>
              </>
            )}
          </dl>
          <p className="field-help">
            This version supports photos and previews on your LAN. Videos, cloud
            routing and device settings aren’t available.
          </p>
        </Modal>
      )}
      {detail && frame && (
        <Modal title="A closer look" close={() => setDetail(null)} wide>
          <div className="lightbox-image">
            <img
              src={imageURL(peer, detail.id, true)}
              alt="Selected photo from your frame"
            />
          </div>
          <div className="lightbox-info">
            <div>
              <strong>{date(detail.received)}</strong>
              <span>
                {detail.visible ? "In slideshow" : "Hidden from slideshow"} ·{" "}
                {detail.type}
              </span>
            </div>
            <a
              className="secondary"
              href={imageURL(peer, detail.id, true) + "&download=1"}
            >
              <ArrowDownToLine size={16} /> Download
            </a>
            {frame.permissions.manage_photos && (
              <>
                <button
                  className="secondary"
                  onClick={() => action("display", [detail.id])}
                >
                  <Monitor size={16} /> Display on frame
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    action(detail.visible ? "hide" : "show", [detail.id])
                  }
                >
                  {detail.visible ? <EyeOff size={16} /> : <Eye size={16} />}{" "}
                  {detail.visible ? "Hide" : "Show"}
                </button>
                <button
                  className="icon-button danger-text"
                  aria-label="Delete this photo"
                  onClick={() => {
                    setSelected(new Set([detail.id]));
                    setDetail(null);
                    setDialog("delete");
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  location.pathname === "/phone" ? <PhonePage /> : <App />,
);

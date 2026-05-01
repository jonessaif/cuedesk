"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";

type CameraRow = {
  id: number;
  name: string;
  url: string;
  snapshotUrl: string | null;
  isEnabled: boolean;
  status: "online" | "offline" | "unknown";
  lastCheckedAt: string | null;
  lastOnlineAt: string | null;
  lastError: string | null;
};

type MappingRow = {
  id: number;
  cameraId: number;
  tableId: number;
  detectionType: "snooker" | "pool" | "playstation" | "other";
  roiX: number;
  roiY: number;
  roiWidth: number;
  roiHeight: number;
  roiAngle: number;
  roiTiltX: number;
  roiTiltY: number;
  roiKind?: "rectangle" | "quadrilateral";
  roiQuadrilateral?: Array<{ x: number; y: number }> | null;
  isEnabled: boolean;
};

type TableRow = {
  id: number;
  name: string;
};

type RoiRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  tiltX: number;
  tiltY: number;
  mode: "rectangle" | "quadrilateral";
  quadrilateral: Array<{ x: number; y: number }>;
};

type ImageViewport = {
  imageWidth: number;
  imageHeight: number;
  displayWidth: number;
  displayHeight: number;
  offsetX: number;
  offsetY: number;
};

type DragState =
  | { mode: "draw"; startX: number; startY: number }
  | { mode: "move"; startX: number; startY: number; original: RoiRect }
  | { mode: "resize"; startX: number; startY: number; original: RoiRect }
  | { mode: "rotate"; startAngle: number; original: RoiRect }
  | { mode: "quad-point"; pointIndex: number; original: RoiRect };

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function getQuadrilateralBounds(points: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(20, maxX - minX),
    height: Math.max(20, maxY - minY),
  };
}

function getImageViewport(
  previewWidth: number,
  previewHeight: number,
  imageWidth: number,
  imageHeight: number,
): ImageViewport | null {
  if (previewWidth <= 0 || previewHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  const imageAspect = imageWidth / imageHeight;
  const previewAspect = previewWidth / previewHeight;
  if (imageAspect > previewAspect) {
    const displayWidth = previewWidth;
    const displayHeight = previewWidth / imageAspect;
    return {
      imageWidth,
      imageHeight,
      displayWidth,
      displayHeight,
      offsetX: 0,
      offsetY: (previewHeight - displayHeight) / 2,
    };
  }
  const displayHeight = previewHeight;
  const displayWidth = previewHeight * imageAspect;
  return {
    imageWidth,
    imageHeight,
    displayWidth,
    displayHeight,
    offsetX: (previewWidth - displayWidth) / 2,
    offsetY: 0,
  };
}

function displayToImagePoint(point: { x: number; y: number }, viewport: ImageViewport): { x: number; y: number } {
  const normalizedX = (point.x - viewport.offsetX) / viewport.displayWidth;
  const normalizedY = (point.y - viewport.offsetY) / viewport.displayHeight;
  return {
    x: clamp(normalizedX * viewport.imageWidth, 0, viewport.imageWidth),
    y: clamp(normalizedY * viewport.imageHeight, 0, viewport.imageHeight),
  };
}

function imageToDisplayPoint(point: { x: number; y: number }, viewport: ImageViewport): { x: number; y: number } {
  return {
    x: viewport.offsetX + (point.x / viewport.imageWidth) * viewport.displayWidth,
    y: viewport.offsetY + (point.y / viewport.imageHeight) * viewport.displayHeight,
  };
}

export default function CameraManagementPage() {
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyCameraId, setBusyCameraId] = useState<number | null>(null);

  const [newCameraName, setNewCameraName] = useState("");
  const [newCameraUrl, setNewCameraUrl] = useState("");
  const [snapshotBlobUrl, setSnapshotBlobUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [exportingConfig, setExportingConfig] = useState(false);

  const [mapCameraId, setMapCameraId] = useState("");
  const [mapTableId, setMapTableId] = useState("");
  const [mapDetectionType, setMapDetectionType] = useState<"snooker" | "pool" | "playstation" | "other">("snooker");
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [selectedMappingPreviewId, setSelectedMappingPreviewId] = useState<number | null>(null);

  const [roiRect, setRoiRect] = useState<RoiRect>({
    x: 20,
    y: 20,
    width: 200,
    height: 120,
    angle: 0,
    tiltX: 0,
    tiltY: 0,
    mode: "quadrilateral",
    quadrilateral: [],
  });
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const roiRectRef = useRef<RoiRect>(roiRect);
  const pendingRoiRef = useRef<RoiRect | null>(null);
  const rafRef = useRef<number | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [snapshotNaturalSize, setSnapshotNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const selectedCameraId = mapCameraId ? Number(mapCameraId) : null;

  const selectedCamera = useMemo(
    () => cameras.find((row) => row.id === selectedCameraId) ?? null,
    [cameras, selectedCameraId],
  );

  const canEditRoi = selectedCameraId !== null && (editingMappingId !== null || selectedMappingPreviewId === null);
  const imageViewport = useMemo(
    () => {
      if (!snapshotNaturalSize) {
        return null;
      }
      return getImageViewport(
        previewSize.width,
        previewSize.height,
        snapshotNaturalSize.width,
        snapshotNaturalSize.height,
      );
    },
    [previewSize.height, previewSize.width, snapshotNaturalSize],
  );
  const roiRectDisplay = useMemo(() => {
    if (!imageViewport) {
      return null;
    }
    const topLeft = imageToDisplayPoint({ x: roiRect.x, y: roiRect.y }, imageViewport);
    return {
      left: topLeft.x,
      top: topLeft.y,
      width: roiRect.width * (imageViewport.displayWidth / imageViewport.imageWidth),
      height: roiRect.height * (imageViewport.displayHeight / imageViewport.imageHeight),
    };
  }, [imageViewport, roiRect.height, roiRect.width, roiRect.x, roiRect.y]);
  const quadDisplayPoints = useMemo(() => {
    if (!imageViewport) {
      return [];
    }
    return roiRect.quadrilateral.map((point) => imageToDisplayPoint(point, imageViewport));
  }, [imageViewport, roiRect.quadrilateral]);

  useEffect(() => {
    roiRectRef.current = roiRect;
  }, [roiRect]);

  function scheduleRoiUpdate(next: RoiRect) {
    pendingRoiRef.current = next;
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingRoiRef.current;
      if (!pending) {
        return;
      }
      pendingRoiRef.current = null;
      setRoiRect((prev) => {
        if (
          prev.x === pending.x
          && prev.y === pending.y
          && prev.width === pending.width
          && prev.height === pending.height
          && prev.angle === pending.angle
          && prev.tiltX === pending.tiltX
          && prev.tiltY === pending.tiltY
          && prev.mode === pending.mode
          && JSON.stringify(prev.quadrilateral) === JSON.stringify(pending.quadrilateral)
        ) {
          return prev;
        }
        return pending;
      });
    });
  }

  function authHeaders(): HeadersInit {
    return activeUserId ? { "x-user-id": String(activeUserId) } : {};
  }

  async function readJsonSafe<T>(res: Response): Promise<T | null> {
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async function loadAll() {
    if (!activeUserId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [cameraRes, tableRes, mappingRes] = await Promise.all([
        fetch("/api/cameras", { cache: "no-store", headers: authHeaders() }),
        fetch("/api/tables", { cache: "no-store", headers: authHeaders() }),
        fetch("/api/camera-mappings", { cache: "no-store", headers: authHeaders() }),
      ]);
      const cameraBody = await readJsonSafe<{ data?: CameraRow[]; error?: string }>(cameraRes);
      const tableBody = await readJsonSafe<{ data?: Array<{ id: number; name: string }>; error?: string }>(tableRes);
      const mappingBody = await readJsonSafe<{ data?: MappingRow[]; error?: string }>(mappingRes);
      if (!cameraRes.ok) {
        throw new Error(cameraBody?.error ?? "Failed to load cameras");
      }
      if (!tableRes.ok) {
        throw new Error(tableBody?.error ?? "Failed to load tables");
      }
      if (!mappingRes.ok) {
        throw new Error(mappingBody?.error ?? "Failed to load mappings");
      }
      setCameras(cameraBody?.data ?? []);
      setTables((tableBody?.data ?? []).map((row) => ({ id: row.id, name: row.name })));
      setMappings(mappingBody?.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function createCamera() {
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/cameras", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: newCameraName,
          url: newCameraUrl,
        }),
      });
      const body = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to create camera");
      }
      setMessage("Camera created");
      setNewCameraName("");
      setNewCameraUrl("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create camera");
    }
  }

  async function editCamera(camera: CameraRow) {
    const nextName = window.prompt("Camera name", camera.name);
    if (nextName === null) {
      return;
    }
    const nextUrl = window.prompt("Camera URL", camera.url);
    if (nextUrl === null) {
      return;
    }
    setBusyCameraId(camera.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/cameras/${camera.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: nextName, url: nextUrl }),
      });
      const body = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to update camera");
      }
      setMessage("Camera updated");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update camera");
    } finally {
      setBusyCameraId(null);
    }
  }

  async function toggleCameraEnabled(camera: CameraRow) {
    setBusyCameraId(camera.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/cameras/${camera.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ isEnabled: !camera.isEnabled }),
      });
      const body = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to update camera");
      }
      setMessage(`Camera ${camera.isEnabled ? "disabled" : "enabled"}`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update camera");
    } finally {
      setBusyCameraId(null);
    }
  }

  async function deleteCamera(cameraId: number) {
    if (!window.confirm("Delete this camera and its mappings?")) {
      return;
    }
    setBusyCameraId(cameraId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/cameras/${cameraId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const body = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to delete camera");
      }
      setMessage("Camera deleted");
      if (selectedCameraId === cameraId) {
        setMapCameraId("");
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete camera");
    } finally {
      setBusyCameraId(null);
    }
  }

  async function loadSnapshot(cameraId: number, refresh: boolean) {
    setSnapshotLoading(true);
    setSnapshotNaturalSize(null);
    try {
      const res = await fetch(`/api/cameras/${cameraId}/snapshot${refresh ? "?refresh=1" : ""}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await readJsonSafe<{ error?: string }>(res);
        throw new Error(body?.error ?? "Failed to load snapshot");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setSnapshotBlobUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return objectUrl;
      });
    } catch (err) {
      setSnapshotNaturalSize(null);
      setSnapshotBlobUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      setError(err instanceof Error ? err.message : "Failed to load snapshot");
    } finally {
      setSnapshotLoading(false);
    }
  }

  async function probeCamera(cameraId: number) {
    setBusyCameraId(cameraId);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/cameras/${cameraId}/probe`, {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await readJsonSafe<{
        error?: string;
        probe?: { detail?: string; resolution?: { width: number; height: number } | null };
        snapshotCaptured?: boolean;
        snapshotError?: string | null;
      }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to probe camera");
      }
      const probeDetail = safeText(body?.probe?.detail) || "ok";
      const probeResolution = body?.probe?.resolution;
      const resolutionSuffix = probeResolution
        ? ` | source ${probeResolution.width}x${probeResolution.height}`
        : "";
      setMessage(`Probe complete: ${probeDetail}${resolutionSuffix}`);
      await loadAll();
      if (cameraId === selectedCameraId) {
        await loadSnapshot(cameraId, false);
      }
      if (body?.snapshotError) {
        setError(`Probe ok, but snapshot failed: ${body.snapshotError}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to probe camera");
    } finally {
      setBusyCameraId(null);
    }
  }

  async function pushLocalConfigFile() {
    setExportingConfig(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/cv/config?write=1", {
        headers: authHeaders(),
      });
      const body = await readJsonSafe<{ error?: string; path?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to write local config");
      }
      setMessage(`Config written to ${body?.path ?? "dist/cv-worker-config.json"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to write local config");
    } finally {
      setExportingConfig(false);
    }
  }

  async function saveMapping() {
    setError("");
    setMessage("");
    try {
      if (!mapCameraId) {
        throw new Error("Select a camera first");
      }
      if (!mapTableId) {
        throw new Error("Select a table first");
      }
      const isQuadrilateral = roiRect.mode === "quadrilateral";
      if (isQuadrilateral && roiRect.quadrilateral.length !== 4) {
        throw new Error("Drop exactly 4 points for quadrilateral ROI");
      }
      const fallbackRect = isQuadrilateral
        ? getQuadrilateralBounds(roiRect.quadrilateral)
        : roiRect;
      const payload = {
        cameraId: Number(mapCameraId),
        tableId: Number(mapTableId),
        detectionType: mapDetectionType,
        roi: {
          x: Math.round(fallbackRect.x),
          y: Math.round(fallbackRect.y),
          width: Math.round(fallbackRect.width),
          height: Math.round(fallbackRect.height),
          angle: Math.round(normalizeAngle(roiRect.angle) * 100) / 100,
          tiltX: Math.round(roiRect.tiltX * 100) / 100,
          tiltY: Math.round(roiRect.tiltY * 100) / 100,
          kind: roiRect.mode,
          quadrilateral: isQuadrilateral ? roiRect.quadrilateral.map((point) => ({
            x: Math.round(point.x * 100) / 100,
            y: Math.round(point.y * 100) / 100,
          })) : null,
        },
      };

      if (editingMappingId) {
        const res = await fetch(`/api/camera-mappings/${editingMappingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            detectionType: payload.detectionType,
            roi: payload.roi,
          }),
        });
        const body = await readJsonSafe<{ error?: string }>(res);
        if (!res.ok) {
          throw new Error(body?.error ?? "Failed to update mapping");
        }
        setMessage("Mapping updated");
        setSelectedMappingPreviewId(editingMappingId);
      } else {
        const res = await fetch("/api/camera-mappings", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const body = await readJsonSafe<{ error?: string }>(res);
        if (!res.ok) {
          throw new Error(body?.error ?? "Failed to create mapping");
        }
        setMessage("Mapping created");
        setSelectedMappingPreviewId(null);
      }

      await loadAll();
      setEditingMappingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save mapping");
    }
  }

  function startEditMapping(mapping: MappingRow) {
    setSelectedMappingPreviewId(mapping.id);
    setEditingMappingId(mapping.id);
    setMapCameraId(String(mapping.cameraId));
    setMapTableId(String(mapping.tableId));
    setMapDetectionType(mapping.detectionType);
    setRoiRect({
      x: mapping.roiX,
      y: mapping.roiY,
      width: mapping.roiWidth,
      height: mapping.roiHeight,
      angle: mapping.roiAngle ?? 0,
      tiltX: mapping.roiTiltX ?? 0,
      tiltY: mapping.roiTiltY ?? 0,
      mode: mapping.roiKind === "quadrilateral" ? "quadrilateral" : "rectangle",
      quadrilateral: Array.isArray(mapping.roiQuadrilateral)
        ? mapping.roiQuadrilateral.filter((point): point is { x: number; y: number } => (
          typeof point === "object"
          && point !== null
          && "x" in point
          && "y" in point
          && Number.isFinite((point as { x: number }).x)
          && Number.isFinite((point as { y: number }).y)
        )).slice(0, 4)
        : [],
    });
  }

  function previewMapping(mapping: MappingRow) {
    setSelectedMappingPreviewId(mapping.id);
    setEditingMappingId(null);
    setMapCameraId(String(mapping.cameraId));
    setMapTableId(String(mapping.tableId));
    setMapDetectionType(mapping.detectionType);
    setRoiRect({
      x: mapping.roiX,
      y: mapping.roiY,
      width: mapping.roiWidth,
      height: mapping.roiHeight,
      angle: mapping.roiAngle ?? 0,
      tiltX: mapping.roiTiltX ?? 0,
      tiltY: mapping.roiTiltY ?? 0,
      mode: mapping.roiKind === "quadrilateral" ? "quadrilateral" : "rectangle",
      quadrilateral: Array.isArray(mapping.roiQuadrilateral)
        ? mapping.roiQuadrilateral.filter((point): point is { x: number; y: number } => (
          typeof point === "object"
          && point !== null
          && "x" in point
          && "y" in point
          && Number.isFinite((point as { x: number }).x)
          && Number.isFinite((point as { y: number }).y)
        )).slice(0, 4)
        : [],
    });
  }

  function cancelEditMapping() {
    if (selectedMappingPreviewId !== null) {
      const selected = mappings.find((row) => row.id === selectedMappingPreviewId);
      if (selected) {
        previewMapping(selected);
      }
    }
    setEditingMappingId(null);
  }

  async function deleteMapping(mappingId: number) {
    if (!window.confirm("Delete this mapping?")) {
      return;
    }
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/camera-mappings/${mappingId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const body = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to delete mapping");
      }
      setMessage("Mapping deleted");
      if (editingMappingId === mappingId) {
        setEditingMappingId(null);
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete mapping");
    }
  }

  function getPointFromEvent(
    clientX: number,
    clientY: number,
    options?: { clampToImage?: boolean },
  ): { x: number; y: number } | null {
    const root = previewRef.current;
    const viewport = imageViewport;
    if (!root || !viewport) {
      return null;
    }
    const rect = root.getBoundingClientRect();
    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;
    const minX = viewport.offsetX;
    const maxX = viewport.offsetX + viewport.displayWidth;
    const minY = viewport.offsetY;
    const maxY = viewport.offsetY + viewport.displayHeight;
    if (options?.clampToImage) {
      return displayToImagePoint(
        {
          x: clamp(rawX, minX, maxX),
          y: clamp(rawY, minY, maxY),
        },
        viewport,
      );
    }
    if (rawX < minX || rawX > maxX || rawY < minY || rawY > maxY) {
      return null;
    }
    return displayToImagePoint({ x: rawX, y: rawY }, viewport);
  }

  function handlePreviewPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditRoi) {
      return;
    }
    event.preventDefault();
    const point = getPointFromEvent(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    if (roiRectRef.current.mode === "quadrilateral") {
      const nextPoints = roiRectRef.current.quadrilateral.length >= 4
        ? [{ x: point.x, y: point.y }]
        : [...roiRectRef.current.quadrilateral, { x: point.x, y: point.y }];
      const bounds = getQuadrilateralBounds(nextPoints);
      scheduleRoiUpdate({
        ...roiRectRef.current,
        ...bounds,
        quadrilateral: nextPoints,
      });
      return;
    }
    dragStateRef.current = { mode: "draw", startX: point.x, startY: point.y };
    scheduleRoiUpdate({
      x: point.x,
      y: point.y,
      width: 20,
      height: 20,
      angle: 0,
      tiltX: roiRectRef.current.tiltX,
      tiltY: roiRectRef.current.tiltY,
      mode: "rectangle",
      quadrilateral: [],
    });
  }

  function handleRectPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditRoi) {
      return;
    }
    if (roiRectRef.current.mode !== "rectangle") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = getPointFromEvent(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const current = roiRectRef.current;
    dragStateRef.current = { mode: "move", startX: point.x, startY: point.y, original: current };
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditRoi) {
      return;
    }
    if (roiRectRef.current.mode !== "rectangle") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = getPointFromEvent(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const current = roiRectRef.current;
    dragStateRef.current = { mode: "resize", startX: point.x, startY: point.y, original: current };
  }

  function handleRotatePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditRoi) {
      return;
    }
    if (roiRectRef.current.mode !== "rectangle") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = getPointFromEvent(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const current = roiRectRef.current;
    const centerX = current.x + current.width / 2;
    const centerY = current.y + current.height / 2;
    const startAngle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI);
    dragStateRef.current = { mode: "rotate", startAngle, original: current };
  }

  function handleQuadPointPointerDown(pointIndex: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canEditRoi) {
      return;
    }
    if (roiRectRef.current.mode !== "quadrilateral") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const current = roiRectRef.current;
    if (pointIndex < 0 || pointIndex >= current.quadrilateral.length) {
      return;
    }
    dragStateRef.current = { mode: "quad-point", pointIndex, original: current };
  }

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current;
      const viewport = imageViewport;
      if (!dragState) {
        return;
      }
      const point = getPointFromEvent(event.clientX, event.clientY, { clampToImage: true });
      if (!point || !viewport) {
        return;
      }
      const maxWidth = viewport.imageWidth;
      const maxHeight = viewport.imageHeight;

      if (dragState.mode === "draw") {
        const x = Math.min(dragState.startX, point.x);
        const y = Math.min(dragState.startY, point.y);
        const width = Math.max(20, Math.abs(point.x - dragState.startX));
        const height = Math.max(20, Math.abs(point.y - dragState.startY));
        scheduleRoiUpdate({
          x: clamp(x, 0, maxWidth - 20),
          y: clamp(y, 0, maxHeight - 20),
          width: clamp(width, 20, maxWidth),
          height: clamp(height, 20, maxHeight),
          angle: roiRectRef.current.angle,
          tiltX: roiRectRef.current.tiltX,
          tiltY: roiRectRef.current.tiltY,
          mode: "rectangle",
          quadrilateral: [],
        });
        return;
      }

      if (dragState.mode === "move") {
        const dx = point.x - dragState.startX;
        const dy = point.y - dragState.startY;
        scheduleRoiUpdate({
          x: clamp(dragState.original.x + dx, 0, maxWidth - dragState.original.width),
          y: clamp(dragState.original.y + dy, 0, maxHeight - dragState.original.height),
          width: dragState.original.width,
          height: dragState.original.height,
          angle: dragState.original.angle,
          tiltX: dragState.original.tiltX,
          tiltY: dragState.original.tiltY,
          mode: dragState.original.mode,
          quadrilateral: dragState.original.quadrilateral,
        });
        return;
      }

      if (dragState.mode === "rotate") {
        const centerX = dragState.original.x + dragState.original.width / 2;
        const centerY = dragState.original.y + dragState.original.height / 2;
        const currentAngle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI);
        const delta = currentAngle - dragState.startAngle;
        scheduleRoiUpdate({
          ...dragState.original,
          angle: normalizeAngle(dragState.original.angle + delta),
        });
        return;
      }

      if (dragState.mode === "quad-point") {
        const nextPoints = [...dragState.original.quadrilateral];
        if (dragState.pointIndex < 0 || dragState.pointIndex >= nextPoints.length) {
          return;
        }
        nextPoints[dragState.pointIndex] = { x: point.x, y: point.y };
        const bounds = getQuadrilateralBounds(nextPoints);
        scheduleRoiUpdate({
          ...dragState.original,
          ...bounds,
          quadrilateral: nextPoints,
        });
        return;
      }

      const dx = point.x - dragState.startX;
      const dy = point.y - dragState.startY;
      scheduleRoiUpdate({
        x: dragState.original.x,
        y: dragState.original.y,
        width: clamp(dragState.original.width + dx, 20, maxWidth - dragState.original.x),
        height: clamp(dragState.original.height + dy, 20, maxHeight - dragState.original.y),
        angle: dragState.original.angle,
        tiltX: dragState.original.tiltX,
        tiltY: dragState.original.tiltY,
        mode: dragState.original.mode,
        quadrilateral: dragState.original.quadrilateral,
      });
    }

    function onPointerDone() {
      dragStateRef.current = null;
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerDone);
    window.addEventListener("pointercancel", onPointerDone);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerDone);
      window.removeEventListener("pointercancel", onPointerDone);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [imageViewport]);

  useEffect(() => {
    const raw = typeof window !== "undefined"
      ? (window.localStorage.getItem("cuedesk-active-user") ?? window.localStorage.getItem("activeUser"))
      : null;
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { id?: number };
      if (typeof parsed.id === "number" && parsed.id > 0) {
        setActiveUserId(parsed.id);
      }
    } catch {
      // ignore malformed local state
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [activeUserId]);

  useEffect(() => {
    if (!selectedCameraId) {
      setSnapshotNaturalSize(null);
      setSnapshotBlobUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      return;
    }
    // Clear previous camera frame immediately to avoid showing stale snapshot while loading.
    setSnapshotNaturalSize(null);
    setSnapshotBlobUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    void loadSnapshot(selectedCameraId, false);
  }, [selectedCameraId]);

  useEffect(() => () => {
    if (snapshotBlobUrl) {
      URL.revokeObjectURL(snapshotBlobUrl);
    }
  }, [snapshotBlobUrl]);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) {
      return;
    }
    const sync = () => {
      const rect = root.getBoundingClientRect();
      setPreviewSize({ width: rect.width, height: rect.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Camera Configuration</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-60"
              disabled={exportingConfig}
              onClick={() => void pushLocalConfigFile()}
            >
              {exportingConfig ? "Pushing..." : "Push To Local Config File"}
            </button>
            <Link href="/management" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
              Back to Management
            </Link>
          </div>
        </div>

        {loading ? <p className="text-sm text-slate-600">Loading...</p> : null}
        {error ? <p className="rounded bg-rose-100 p-3 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="rounded bg-emerald-100 p-3 text-sm text-emerald-700">{message}</p> : null}

        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Add Camera</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded border p-2"
              placeholder="Camera name"
              value={newCameraName}
              onChange={(e) => setNewCameraName(e.target.value)}
            />
            <input
              className="rounded border p-2"
              placeholder="Camera URL (rtsp/http/https)"
              value={newCameraUrl}
              onChange={(e) => setNewCameraUrl(e.target.value)}
            />
          </div>
          <button className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => void createCamera()}>
            Save Camera
          </button>
        </section>

        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Cameras</h2>
          <div className="space-y-2">
            {cameras.map((camera) => (
              <div key={camera.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
                <div>
                  <p className="font-medium">{camera.name}</p>
                  <p className="text-sm text-slate-600">{camera.url}</p>
                  <p className="text-xs text-slate-500">
                    Status: {camera.status} | Enabled: {camera.isEnabled ? "yes" : "no"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    disabled={busyCameraId === camera.id}
                    onClick={() => setMapCameraId(String(camera.id))}
                  >
                    Use In Mapping
                  </button>
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    disabled={busyCameraId === camera.id}
                    onClick={() => void editCamera(camera)}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    disabled={busyCameraId === camera.id}
                    onClick={() => void toggleCameraEnabled(camera)}
                  >
                    {camera.isEnabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
                    disabled={busyCameraId === camera.id}
                    onClick={() => void probeCamera(camera.id)}
                  >
                    {busyCameraId === camera.id ? "Probing..." : "Probe"}
                  </button>
                  <button
                    className="rounded bg-rose-600 px-3 py-1 text-sm text-white"
                    disabled={busyCameraId === camera.id}
                    onClick={() => void deleteCamera(camera.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {cameras.length === 0 ? <p className="text-sm text-slate-600">No cameras yet.</p> : null}
          </div>
        </section>

        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Assign Camera To Table (draw ROI with mouse)</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <select
              className="rounded border p-2"
              value={mapCameraId}
              onChange={(e) => {
                setMapCameraId(e.target.value);
                setSelectedMappingPreviewId(null);
                setEditingMappingId(null);
              }}
            >
              <option value="">Select camera</option>
              {cameras.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select
              className="rounded border p-2"
              value={mapTableId}
              onChange={(e) => {
                setMapTableId(e.target.value);
                setSelectedMappingPreviewId(null);
              }}
            >
              <option value="">Select table</option>
              {tables.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select
              className="rounded border p-2"
              value={mapDetectionType}
              onChange={(e) => {
                setMapDetectionType(e.target.value as never);
                setSelectedMappingPreviewId(null);
              }}
            >
              <option value="snooker">snooker</option>
              <option value="pool">pool</option>
              <option value="playstation">playstation</option>
              <option value="other">other</option>
            </select>
            <button
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
              disabled={selectedMappingPreviewId !== null && editingMappingId === null}
              onClick={() => void saveMapping()}
            >
              {editingMappingId ? "Update Mapping" : "Save Mapping"}
            </button>
          </div>
          {selectedMappingPreviewId !== null && editingMappingId === null ? (
            <div className="mt-2 text-xs text-slate-600">
              Preview mode: click <strong>Edit</strong> on the selected mapping to modify ROI.
            </div>
          ) : null}
          {editingMappingId ? (
            <div className="mt-2">
              <button type="button" className="rounded border px-2 py-1 text-xs" onClick={cancelEditMapping}>
                Cancel Edit
              </button>
            </div>
          ) : null}
          <div className="mt-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              ROI Mode
              <select
                className="rounded border p-1 text-xs"
                value={roiRect.mode}
                disabled={!canEditRoi}
                onChange={(event) => {
                  const nextMode = event.target.value === "quadrilateral" ? "quadrilateral" : "rectangle";
                  setRoiRect((prev) => ({
                    ...prev,
                    mode: nextMode,
                    quadrilateral: nextMode === "quadrilateral" ? prev.quadrilateral : [],
                  }));
                }}
              >
                <option value="quadrilateral">Quadrilateral (4 points)</option>
                <option value="rectangle">Rectangle</option>
              </select>
              {roiRect.mode === "quadrilateral" ? (
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  disabled={!canEditRoi}
                  onClick={() => setRoiRect((prev) => ({ ...prev, quadrilateral: [] }))}
                >
                  Clear Points
                </button>
              ) : null}
            </label>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            ROI: mode={roiRect.mode}, x={Math.round(roiRect.x)}, y={Math.round(roiRect.y)}, w={Math.round(roiRect.width)}, h={Math.round(roiRect.height)}, rotZ={Math.round(normalizeAngle(roiRect.angle) * 10) / 10}deg, tiltX={Math.round(roiRect.tiltX * 10) / 10}deg, tiltY={Math.round(roiRect.tiltY * 10) / 10}deg
          </div>
          {roiRect.mode === "quadrilateral" ? (
            <div className="mt-1 text-xs text-slate-600">
              Click on snapshot to place points: {roiRect.quadrilateral.length}/4. Drag any green point to adjust.
            </div>
          ) : null}
          {roiRect.mode === "rectangle" ? (
            <div className="mt-2 space-y-1">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Rotation Z
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={Math.round(normalizeAngle(roiRect.angle))}
                  disabled={!canEditRoi}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRoiRect((prev) => ({ ...prev, angle: normalizeAngle(value) }));
                  }}
                />
                <span>{Math.round(normalizeAngle(roiRect.angle))}deg</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Tilt X
                <input
                  type="range"
                  min={-80}
                  max={80}
                  step={1}
                  value={Math.round(roiRect.tiltX)}
                  disabled={!canEditRoi}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRoiRect((prev) => ({ ...prev, tiltX: clamp(value, -80, 80) }));
                  }}
                />
                <span>{Math.round(roiRect.tiltX)}deg</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Tilt Y
                <input
                  type="range"
                  min={-80}
                  max={80}
                  step={1}
                  value={Math.round(roiRect.tiltY)}
                  disabled={!canEditRoi}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRoiRect((prev) => ({ ...prev, tiltY: clamp(value, -80, 80) }));
                  }}
                />
                <span>{Math.round(roiRect.tiltY)}deg</span>
              </label>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Snapshot for selected mapping camera</p>
                <button
                  className="rounded border px-2 py-1 text-xs"
                  disabled={!selectedCameraId || snapshotLoading}
                  onClick={() => {
                    if (!selectedCameraId) {
                      return;
                    }
                    void loadSnapshot(selectedCameraId, true);
                  }}
                >
                  {snapshotLoading ? "Refreshing..." : "Refresh Snapshot"}
                </button>
              </div>
              <div
                ref={previewRef}
                className="relative h-64 select-none overflow-hidden rounded border bg-black"
                onPointerDown={handlePreviewPointerDown}
              >
                {snapshotBlobUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={snapshotBlobUrl}
                    alt="camera snapshot"
                    draggable={false}
                    className="pointer-events-none h-full w-full object-contain"
                    onLoad={(event) => {
                      const img = event.currentTarget;
                      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                        setSnapshotNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                      }
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    {selectedCamera ? "No snapshot yet. Probe or Refresh." : "Select camera in dropdown first"}
                  </div>
                )}
                {selectedCamera ? (
                  <>
                    <div
                      className="absolute cursor-grab border-2 border-lime-500 active:cursor-grabbing"
                      onPointerDown={handleRectPointerDown}
                      style={{
                        left: roiRectDisplay?.left ?? 0,
                        top: roiRectDisplay?.top ?? 0,
                        width: roiRectDisplay?.width ?? 0,
                        height: roiRectDisplay?.height ?? 0,
                        transform: `perspective(800px) rotateX(${roiRect.tiltX}deg) rotateY(${roiRect.tiltY}deg) rotate(${normalizeAngle(roiRect.angle)}deg)`,
                        transformOrigin: "center center",
                        display: roiRect.mode === "rectangle" && roiRectDisplay ? "block" : "none",
                      }}
                    >
                      <div
                        className="absolute h-3 w-3 cursor-se-resize border border-white bg-lime-500"
                        onPointerDown={handleResizePointerDown}
                        style={{
                          right: -6,
                          bottom: -6,
                        }}
                      />
                      <div
                        className="absolute h-3 w-3 cursor-alias rounded-full border border-white bg-sky-400"
                        onPointerDown={handleRotatePointerDown}
                        style={{
                          left: "50%",
                          top: -22,
                          transform: "translateX(-50%)",
                        }}
                      />
                    </div>
                    {roiRect.mode === "quadrilateral" ? (
                      <svg className="pointer-events-none absolute inset-0 h-full w-full">
                        {quadDisplayPoints.length >= 2 ? (
                          <polyline
                            points={quadDisplayPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                            fill="none"
                            stroke="#22c55e"
                            strokeWidth={2}
                          />
                        ) : null}
                        {quadDisplayPoints.length === 4 ? (
                          <polygon
                            points={quadDisplayPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                            fill="rgba(34,197,94,0.12)"
                            stroke="#22c55e"
                            strokeWidth={2}
                          />
                        ) : null}
                        {quadDisplayPoints.map((point, index) => (
                          <g key={`${point.x}-${point.y}-${index}`}>
                            <circle cx={point.x} cy={point.y} r={5} fill="#22c55e" stroke="#ffffff" strokeWidth={1.5} />
                            <text x={point.x + 8} y={point.y - 8} fontSize={10} fill="#dcfce7">
                              {index + 1}
                            </text>
                          </g>
                        ))}
                      </svg>
                    ) : null}
                    {roiRect.mode === "quadrilateral"
                      ? quadDisplayPoints.map((point, index) => (
                        <button
                          key={`handle-${point.x}-${point.y}-${index}`}
                          type="button"
                          aria-label={`Move point ${index + 1}`}
                          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-lime-500"
                          style={{ left: point.x, top: point.y }}
                          onPointerDown={(event) => handleQuadPointPointerDown(index, event)}
                        />
                      ))
                      : null}
                  </>
                ) : null}
              </div>
            </div>
            <div className="rounded border p-3">
              <p className="mb-2 text-sm font-medium">Existing mappings</p>
              <div className="space-y-2">
                {mappings.map((row) => (
                  <div
                    key={row.id}
                    className={`rounded border p-2 text-sm ${selectedMappingPreviewId === row.id ? "border-lime-500 bg-lime-50" : ""}`}
                    onClick={() => previewMapping(row)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        previewMapping(row);
                      }
                    }}
                  >
                    <div>
                      Camera {cameras.find((camera) => camera.id === row.cameraId)?.name ?? `#${row.cameraId}`} {"->"} Table {tables.find((table) => table.id === row.tableId)?.name ?? `#${row.tableId}`} ({row.detectionType}) ROI mode={row.roiKind ?? "rectangle"} [{row.roiX}, {row.roiY}, {row.roiWidth}, {row.roiHeight}, rotZ={row.roiAngle ?? 0}, tiltX={row.roiTiltX ?? 0}, tiltY={row.roiTiltY ?? 0}] {row.isEnabled ? "" : "(disabled)"}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditMapping(row);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteMapping(row.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {mappings.length === 0 ? <p className="text-sm text-slate-600">No mappings yet.</p> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

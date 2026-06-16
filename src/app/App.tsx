import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { FILMS, COUNTRIES } from './filmData';
import type { Film } from './filmData';

// ── palette ───────────────────────────────────────────────────────────────────
const BG_CSS   = '#F0EDE7';
const MID_CSS  = '#8A7E72';
const MUTE_CSS = '#B4ADA4';

// ── three.js / layout constants ───────────────────────────────────────────────
const R           = 5;
const RING_RADIUS = 9.5;
const TILT        = 22 * (Math.PI / 180);
const GLOBE_BODY  = 0x2E2820;
const GRID_COL    = 0x8A7A66;
const RING_COL    = 0xA89A88;
const PANEL_W     = 248;
const MIN_YEAR    = 1985;
const MAX_YEAR    = 2022;

// ── genre color system ────────────────────────────────────────────────────────
const GENRE_DATA: Record<string, { hex: number; css: string; angle: number; cn: string }> = {
  Drama:     { hex: 0x2EAA74, css: '#2EAA74', angle: Math.PI * 0.08, cn: '剧情' },   // emerald green
  'Sci-Fi':  { hex: 0x3A7AE4, css: '#3A7AE4', angle: Math.PI * 0.38, cn: '科幻' },   // cobalt blue
  Animation: { hex: 0xE87820, css: '#E87820', angle: Math.PI * 0.70, cn: '动画' },   // warm orange
  Fantasy:   { hex: 0x9040CC, css: '#9040CC', angle: Math.PI * 1.02, cn: '奇幻' },   // violet
  Romance:   { hex: 0xDC4468, css: '#DC4468', angle: Math.PI * 1.40, cn: '爱情' },   // rose red
  Thriller:  { hex: 0xC8A020, css: '#C8A020', angle: Math.PI * 1.76, cn: '惊悚' },   // golden amber
};
const GENRE_LIST = Object.keys(GENRE_DATA);

const COUNTRY_LIST = Object.keys(COUNTRIES);
const FILM_YEAR_MIN = Math.min(...FILMS.map(f => f.year));
const FILM_YEAR_MAX = Math.max(...FILMS.map(f => f.year));
const FILM_YEAR_SPAN = FILM_YEAR_MAX - FILM_YEAR_MIN + 1;
const FILM_BY_ID = new Map(FILMS.map(film => [film.id, film] as const));
const FILM_COUNT_BY_GENRE: Record<string, number> = {};
const FILM_COUNT_BY_COUNTRY: Record<string, number> = {};
const FILM_COUNT_BY_YEAR: Record<number, number> = {};

for (const film of FILMS) {
  FILM_COUNT_BY_GENRE[film.genre] = (FILM_COUNT_BY_GENRE[film.genre] ?? 0) + 1;
  FILM_COUNT_BY_COUNTRY[film.country] = (FILM_COUNT_BY_COUNTRY[film.country] ?? 0) + 1;
  FILM_COUNT_BY_YEAR[film.year] = (FILM_COUNT_BY_YEAR[film.year] ?? 0) + 1;
}

const COUNTRY_KEYS_WITH_FILMS = COUNTRY_LIST.filter(key => (FILM_COUNT_BY_COUNTRY[key] ?? 0) > 0);

// ── helpers ───────────────────────────────────────────────────────────────────
function getPos(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(r * Math.sin(phi) * Math.cos(theta)),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}
function gp(angle: number): THREE.Vector3 {
  const x = Math.cos(angle) * RING_RADIUS;
  const z0 = Math.sin(angle) * RING_RADIUS;
  return new THREE.Vector3(x, z0 * Math.sin(TILT), z0 * Math.cos(TILT));
}
function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (id: string) => setter(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
}

// parse "$701M" / "$1.1B" → numeric millions
function parseBO(s: string): number {
  const m = s.match(/\$([\d.]+)([MB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2].toUpperCase() === 'B' ? n * 1000 : n;
}

// Given rank (0=best) and total, return position index so that
// rank 0 lands at center and higher ranks radiate outward symmetrically.
function centerOutPos(rank: number, total: number): number {
  if (total <= 1) return 0;
  if (total % 2 === 1) {
    const c = (total - 1) / 2;
    if (rank === 0) return c;
    const off = Math.ceil(rank / 2);
    return rank % 2 === 1 ? c - off : c + off;
  } else {
    const c1 = total / 2 - 1, c2 = total / 2;
    if (rank === 0) return c2;
    if (rank === 1) return c1;
    const off = Math.floor((rank - 2) / 2) + 1;
    return rank % 2 === 0 ? c2 + off : c1 - off;
  }
}

// ── country cap geometry ──────────────────────────────────────────────────────
const COUNTRY_RADII: Record<string, number> = {
  USA: 18,  CANADA: 20, RUSSIA: 20, CHINA: 16, BRAZIL: 15, AUSTRALIA: 16,
  INDIA: 11, ARGENTINA: 12, MEXICO: 9, FRANCE: 5.5, GERMANY: 4.5, SPAIN: 5.5,
  UK: 4.5, IRAN: 8, TURKEY: 7, SWEDEN: 7, NORWAY: 7, POLAND: 4.5,
  ITALY: 5, JAPAN: 4.5, SOUTH_KOREA: 3.5, TAIWAN: 2.2, HONG_KONG: 1.5,
  DENMARK: 3, BELGIUM: 2.5, NETHERLANDS: 2.5, ISRAEL: 2.5, CHILE: 9,
  GREECE: 4, SOUTH_AFRICA: 9, AUSTRIA: 3.5, ROMANIA: 4,
};

function buildCountryCapGeo(lat: number, lon: number, radiusDeg: number): THREE.BufferGeometry {
  const SEGS = 64;
  const RS   = R * 1.012; // clearly above globe surface to avoid z-fighting
  const pos: number[] = [];
  const idx: number[] = [];
  const cp = getPos(lat, lon, RS);
  pos.push(cp.x, cp.y, cp.z);
  const cosLat = Math.cos(lat * Math.PI / 180) || 0.001;
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    const p = getPos(
      Math.max(-88, Math.min(88, lat + Math.cos(a) * radiusDeg)),
      lon + Math.sin(a) * radiusDeg / cosLat,
      RS,
    );
    pos.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < SEGS; i++) idx.push(0, i + 1, ((i + 1) % SEGS) + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

// ── ThreeScene ────────────────────────────────────────────────────────────────
function ThreeScene({
  selectedFilmId,
  onSelect,
  visibleFilmIds,
  visibleFilmSet,
  visibleGenreSet,
  visibleCountrySet,
  onHover,
  resetRef,
  activeCountries = new Set<string>(),
}: {
  selectedFilmId: string | null;
  onSelect: (id: string | null) => void;
  visibleFilmIds: string[];
  visibleFilmSet: Set<string>;
  visibleGenreSet: Set<string>;
  visibleCountrySet: Set<string>;
  onHover: (id: string | null) => void;
  resetRef: React.MutableRefObject<(() => void) | null>;
  activeCountries?: Set<string>;
}) {
  const canvasRef  = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const selectedRef        = useRef(selectedFilmId);
  const onSelectRef        = useRef(onSelect);
  const visibleIdsRef      = useRef(visibleFilmIds);
  const visibleFilmSetRef  = useRef(visibleFilmSet);
  const visibleGenreSetRef = useRef(visibleGenreSet);
  const visibleCountrySetRef = useRef(visibleCountrySet);
  const onHoverRef         = useRef(onHover);
  const activeCountriesRef = useRef(activeCountries);
  const tubeByFilmIdRef    = useRef<Map<string, THREE.Mesh>>(new Map());
  const visibleTubesRef    = useRef<THREE.Mesh[]>([]);
  const syncVisibleTubesRef = useRef<(() => void) | null>(null);

  useEffect(() => { selectedRef.current = selectedFilmId; });
  useEffect(() => { onSelectRef.current = onSelect; });
  useEffect(() => { visibleIdsRef.current = visibleFilmIds; syncVisibleTubesRef.current?.(); }, [visibleFilmIds]);
  useEffect(() => { visibleFilmSetRef.current = visibleFilmSet; }, [visibleFilmSet]);
  useEffect(() => { visibleGenreSetRef.current = visibleGenreSet; }, [visibleGenreSet]);
  useEffect(() => { visibleCountrySetRef.current = visibleCountrySet; }, [visibleCountrySet]);
  useEffect(() => { onHoverRef.current = onHover; });
  useEffect(() => { activeCountriesRef.current = activeCountries; }, [activeCountries]);

  useEffect(() => {
    const el      = canvasRef.current;
    const overlay = overlayRef.current;
    if (!el || !overlay) return;
    let w = el.clientWidth, h = el.clientHeight;

    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(0, 2, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.minDistance = 10; controls.maxDistance = 28;
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.22;

    // latch: once user touches the globe, stop auto-rotation until explicit reset
    let userInteracted = false;
    controls.addEventListener('start', () => { userInteracted = true; });

    resetRef.current = () => {
      camera.position.set(0, 2, 18);
      controls.target.set(0, 0, 0);
      controls.update();
      userInteracted = false;      // re-enable auto-rotation on reset
    };

    scene.add(new THREE.AmbientLight(0xFFF8F0, 2.0));
    const sun = new THREE.DirectionalLight(0xFFF2DC, 0.65);
    sun.position.set(9, 13, 10); scene.add(sun);

    // globe body
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 64),
      new THREE.MeshStandardMaterial({ color: GLOBE_BODY, roughness: 0.86, metalness: 0.06 }),
    ));

    // latitude/longitude grid — explicit line loops to avoid wireframe seam artifact
    const gridMat = new THREE.LineBasicMaterial({ color: GRID_COL, transparent: true, opacity: 0.13, depthWrite: false });
    const RG = R * 1.002;
    const gridLines: THREE.Line[] = [];
    const addLine = (pts: THREE.Vector3[], loop = false) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = loop ? new THREE.LineLoop(geo, gridMat) : new THREE.Line(geo, gridMat);
      scene.add(line); gridLines.push(line as THREE.Line);
    };
    // latitude circles every 30°
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = [];
      const y = RG * Math.sin(lat * Math.PI / 180);
      const r = RG * Math.cos(lat * Math.PI / 180);
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      addLine(pts, true);
    }
    // longitude lines every 30°
    for (let lon = 0; lon < 360; lon += 30) {
      const pts: THREE.Vector3[] = [];
      const theta = lon * Math.PI / 180;
      for (let i = 0; i <= 64; i++) {
        const phi = (i / 64) * Math.PI;
        pts.push(new THREE.Vector3(
          -(RG * Math.sin(phi) * Math.cos(theta)),
          RG * Math.cos(phi),
          RG * Math.sin(phi) * Math.sin(theta),
        ));
      }
      addLine(pts);
    }

    // orbit ring
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      const x = Math.cos(a) * RING_RADIUS, z0 = Math.sin(a) * RING_RADIUS;
      ringPts.push(new THREE.Vector3(x, z0 * Math.sin(TILT), z0 * Math.cos(TILT)));
    }
    const ringMat = new THREE.LineBasicMaterial({ color: RING_COL, transparent: true, opacity: 0.22, depthWrite: false });
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat));

    // country dots — uniform small size, with a halo ring
    const countryCounts: Record<string, number> = {};
    FILMS.forEach(f => { countryCounts[f.country] = (countryCounts[f.country] || 0) + 1; });

    const countryDotMats:  Record<string, THREE.MeshBasicMaterial> = {};
    const countryHaloMats: Record<string, THREE.MeshBasicMaterial> = {};

    Object.entries(COUNTRIES).forEach(([key, data]) => {
      const count = countryCounts[key] || 0;
      if (count === 0) return;
      const pos  = getPos(data.lat, data.lon, R);
      const size = 0.06; // uniform small dot — not scaled by film count

      // inner dot
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xDDD6C8, transparent: true, opacity: 0.88, depthWrite: false });
      const dot    = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 14), dotMat);
      dot.position.copy(pos); scene.add(dot);
      countryDotMats[key] = dotMat;

      // halo ring (torus, perpendicular to globe surface)
      const haloMat  = new THREE.MeshBasicMaterial({ color: 0xDDD6C8, transparent: true, opacity: 0.0, depthWrite: false });
      const halo     = new THREE.Mesh(new THREE.TorusGeometry(size * 2.2, 0.012, 8, 32), haloMat);
      halo.position.copy(pos);
      // orient torus to face outward (normal = normalized position)
      halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
      scene.add(halo);
      countryHaloMats[key] = haloMat;
    });

    // dominant genre per country (computed once at scene init)
    const dominantGenreByCountry: Record<string, string> = (() => {
      const gc: Record<string, Record<string, number>> = {};
      FILMS.forEach(f => {
        if (!gc[f.country]) gc[f.country] = {};
        gc[f.country][f.genre] = (gc[f.country][f.genre] ?? 0) + 1;
      });
      const out: Record<string, string> = {};
      Object.entries(gc).forEach(([c, g]) => {
        out[c] = Object.entries(g).sort((a, b) => b[1] - a[1])[0][0];
      });
      return out;
    })();

    // country territory caps — colored spherical patches
    const countryCapMats: Record<string, THREE.MeshBasicMaterial> = {};

    Object.entries(COUNTRIES).forEach(([key, data]) => {
      if (!countryCounts[key]) return;
      const radiusDeg = COUNTRY_RADII[key] ?? 4;
      const geo = buildCountryCapGeo(data.lat, data.lon, radiusDeg);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      scene.add(new THREE.Mesh(geo, mat));
      countryCapMats[key] = mat;
    });

    // genre ring dots — colored, stored for animation
    const genreDotMats: Record<string, THREE.MeshBasicMaterial> = {};
    Object.entries(GENRE_DATA).forEach(([genre, data]) => {
      const mat = new THREE.MeshBasicMaterial({ color: data.hex, transparent: true, opacity: 0.78, depthWrite: false });
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 14), mat);
      dot.position.copy(gp(data.angle));
      scene.add(dot);
      genreDotMats[genre] = mat;
    });

    // film arcs — one per film, genre-colored
    type FilmObj = { tube: THREE.Mesh; mat: THREE.MeshBasicMaterial; film: Film };
    const filmObjs: FilmObj[] = [];
    const tubeToId = new Map<string, string>();

    // ── arc geometry: sort by box office, center-out layout, weighted visuals ──
    // Group films by country+genre, sort each group by box office desc,
    // then assign center-out positions so the top earner lands at the center.
    const groupMap: Record<string, Film[]> = {};
    FILMS.forEach(f => {
      const k = `${f.country}::${f.genre}`;
      if (!groupMap[k]) groupMap[k] = [];
      groupMap[k].push(f);
    });

    type ArcInfo = { pos: number; total: number; weight: number };
    const filmArcInfo: Record<string, ArcInfo> = {};
    Object.values(groupMap).forEach(films => {
      const n = films.length;
      const sorted = [...films].sort((a, b) => parseBO(b.boxOffice) - parseBO(a.boxOffice));
      sorted.forEach((film, rank) => {
        const pos    = centerOutPos(rank, n);
        const center = (n - 1) / 2;
        // weight: 1.0 at center (top earner), tapers to 0 at edges (lowest earner)
        const weight = n === 1 ? 1.0 : 1 - Math.abs(pos - center) / center;
        filmArcInfo[film.id] = { pos, total: n, weight };
      });
    });

    FILMS.forEach(film => {
      const countryData = COUNTRIES[film.country];
      const genreD      = GENRE_DATA[film.genre];
      if (!countryData || !genreD) return;

      const { pos, total, weight } = filmArcInfo[film.id];
      const t = total > 1 ? pos / (total - 1) : 0.5;

      // spread endpoints along genre ring; stagger arc heights for visual depth
      const spread       = Math.min(0.20, total * 0.016);
      const angleOffset  = (t - 0.5) * spread;
      const heightFactor = 0.36 + t * 0.22;          // 0.36 → 0.58

      // tube radius: thick at center (high box office), thin at edges
      const tubeRadius = 0.013 + weight * 0.018;      // 0.013 → 0.031

      // color saturation: full genre color at center, desaturated at edges
      const baseHsl = { h: 0, s: 0, l: 0 };
      new THREE.Color(genreD.hex).getHSL(baseHsl);
      const satScale = 0.30 + weight * 0.70;          // 30% → 100% of original sat
      const arcColor = new THREE.Color().setHSL(baseHsl.h, baseHsl.s * satScale, baseHsl.l);

      const startPos = getPos(countryData.lat, countryData.lon, R);
      const endPos   = gp(genreD.angle + angleOffset).clone();
      const arcMid   = startPos.clone().add(endPos).multiplyScalar(0.5);
      arcMid.normalize().multiplyScalar(R + startPos.distanceTo(endPos) * heightFactor);
      const curve = new THREE.QuadraticBezierCurve3(startPos, arcMid, endPos);

      const mat  = new THREE.MeshBasicMaterial({ color: arcColor, transparent: true, opacity: 0.0, depthWrite: false });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, tubeRadius, 5, false), mat);
      scene.add(tube); tubeToId.set(tube.uuid, film.id);
      filmObjs.push({ tube, mat, film });
    });

    tubeByFilmIdRef.current = new Map(filmObjs.map(obj => [obj.film.id, obj.tube] as const));
    syncVisibleTubesRef.current = () => {
      visibleTubesRef.current = visibleIdsRef.current
        .map(id => tubeByFilmIdRef.current.get(id))
        .filter((tube): tube is THREE.Mesh => !!tube);
    };
    syncVisibleTubesRef.current();

    // ── HTML label overlay ────────────────────────────────────────────────────
    // country labels
    const countryLabelEls: Record<string, HTMLSpanElement> = {};
    Object.entries(COUNTRIES).forEach(([key, data]) => {
      if (!countryCounts[key]) return;
      const span = document.createElement('span');
      span.textContent = data.cnShort;
      Object.assign(span.style, {
        position: 'absolute', top: '0', left: '0',
        fontSize: '8px', letterSpacing: '0.04em',
        color: '#3A342C', pointerEvents: 'none',
        whiteSpace: 'nowrap', opacity: '0',
        fontFamily: 'inherit',
        background: 'rgba(240,237,231,0.82)',
        padding: '1px 4px', borderRadius: '2px',
        transformOrigin: 'left center',
      });
      overlay.appendChild(span);
      countryLabelEls[key] = span;
    });

    // genre labels
    const genreLabelEls: Record<string, HTMLSpanElement> = {};
    Object.entries(GENRE_DATA).forEach(([genre, data]) => {
      const span = document.createElement('span');
      span.textContent = data.cn;
      Object.assign(span.style, {
        position: 'absolute', top: '0', left: '0',
        fontSize: '16px', letterSpacing: '0.04em',
        color: data.css, pointerEvents: 'none',
        whiteSpace: 'nowrap', opacity: '0',
        fontFamily: 'inherit',
        background: 'rgba(240,237,231,0.88)',
        padding: '2px 6px', borderRadius: '3px',
        transformOrigin: 'left center',
      });
      overlay.appendChild(span);
      genreLabelEls[genre] = span;
    });

    // ── interaction ───────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2(-10, -10);
    let hoveredId: string | null = null;
    const LERP = 0.07;

    renderer.domElement.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    });

    renderer.domElement.addEventListener('click', (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const cm   = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(cm, camera);
      const hits = raycaster.intersectObjects(visibleTubesRef.current);
      if (hits.length > 0) {
        const fid = tubeToId.get(hits[0].object.uuid);
        if (fid) onSelectRef.current(selectedRef.current === fid ? null : fid);
      } else {
        onSelectRef.current(null);
      }
    });

    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      const anySelected = selectedRef.current !== null;
      const isFiltering = visibleFilmSetRef.current.size < FILMS.length;

      controls.autoRotate = !anySelected && !userInteracted;

      // hover — only test tubes that are in the current visible/filtered set
      if (!anySelected) {
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(visibleTubesRef.current);
        const newHovId = hits.length > 0 ? (tubeToId.get(hits[0].object.uuid) ?? null) : null;
        if (newHovId !== hoveredId) { hoveredId = newHovId; onHoverRef.current(newHovId); }
      } else if (hoveredId !== null) {
        hoveredId = null; onHoverRef.current(null);
      }

      // selected film + genre context
      // selActive: selected AND within current filter set (so spotlight mode is meaningful)
      const selActive  = anySelected && visibleFilmSetRef.current.has(selectedRef.current!);
      const selFilm    = selActive ? (FILM_BY_ID.get(selectedRef.current!) ?? null) : null;
      const selGenre   = selFilm?.genre ?? null;
      const selCountry = selFilm?.country ?? null;

      // film arc opacities
      filmObjs.forEach(obj => {
        const isSelected = obj.film.id === selectedRef.current;
        const isHovered  = obj.film.id === hoveredId;
        const isVisible  = visibleFilmSetRef.current.has(obj.film.id);
        let tOp: number;
        if (selActive)        tOp = isSelected ? 0.96 : 0.007;
        else if (isFiltering) tOp = isVisible ? (isHovered ? 0.84 : 0.24) : 0.007;
        else                  tOp = isHovered ? 0.84 : 0.16;
        obj.mat.opacity = THREE.MathUtils.lerp(obj.mat.opacity, tOp, LERP);
      });

      // country dot + halo opacities
      Object.entries(countryDotMats).forEach(([key, mat]) => {
        const isSelCountry = selCountry === key;
        const hasVisible   = visibleCountrySetRef.current.has(key);
        let tOp: number;
        if (selActive)        tOp = isSelCountry ? 1.0 : 0.09;
        else if (isFiltering) tOp = hasVisible ? 0.90 : 0.09;
        else                  tOp = 0.82;
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, tOp, LERP);

        const haloMat = countryHaloMats[key];
        if (haloMat) {
          const haloTarget = (selActive && isSelCountry) ? 0.55 :
                             (!selActive && !isFiltering) ? 0.0 :
                             hasVisible ? 0.22 : 0.0;
          haloMat.opacity = THREE.MathUtils.lerp(haloMat.opacity, haloTarget, LERP);
          if (isSelCountry && selActive) {
            haloMat.color.lerp(new THREE.Color(0xEDE7DC), LERP);
          }
        }
      });

      // country territory cap colors + opacities
      Object.entries(countryCapMats).forEach(([key, mat]) => {
        const isSelCountry = selCountry === key;
        const isActive     = activeCountriesRef.current?.has(key) ?? false;
        let tOp = 0;
        let targetHex: number | null = null;

        if (selActive) {
          if (isSelCountry && selGenre && GENRE_DATA[selGenre]) {
            tOp = 0.52;
            targetHex = GENRE_DATA[selGenre].hex;
          }
        } else if (isActive) {
          const dg = dominantGenreByCountry[key];
          if (dg && GENRE_DATA[dg]) {
            tOp = 0.44;
            targetHex = GENRE_DATA[dg].hex;
          }
        }

        mat.opacity = THREE.MathUtils.lerp(mat.opacity, tOp, LERP);
        // set genre color immediately so it's visible on fade-in (not lerping from white)
        if (targetHex !== null) mat.color.setHex(targetHex);
      });

      // genre dot opacities
      Object.entries(genreDotMats).forEach(([genre, mat]) => {
        const isSelGenre = selGenre === genre;
        const isActive   = !isFiltering || visibleGenreSetRef.current.has(genre);
        let tOp: number;
        if (selActive)        tOp = isSelGenre ? 1.0 : 0.09;
        else if (isFiltering) tOp = isActive ? 0.90 : 0.09;
        else                  tOp = 0.72;
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, tOp, LERP);
      });

      gridMat.opacity = THREE.MathUtils.lerp(gridMat.opacity, selActive ? 0.09 : 0.13, LERP);
      ringMat.opacity = THREE.MathUtils.lerp(ringMat.opacity, selActive ? 0.22 : 0.28, LERP);

      // ── HTML label updates ─────────────────────────────────────────────────
      const camNorm    = camera.position.clone().normalize();
      // scale labels up when zoomed out so they stay legible
      const camDist    = camera.position.length();
      const labelScale = Math.max(0.72, Math.min(1.9, 18 / camDist));

      Object.entries(countryLabelEls).forEach(([key, el]) => {
        const data     = COUNTRIES[key];
        const worldPos = getPos(data.lat, data.lon, R);
        const facing   = worldPos.clone().normalize().dot(camNorm) > 0.30;

        if (!facing) { el.style.opacity = '0'; return; }

        const v = worldPos.clone().project(camera);
        if (v.z > 1) { el.style.opacity = '0'; return; }

        const px = ((v.x + 1) / 2) * w;
        const py = ((-v.y + 1) / 2) * h;
        el.style.transform = `translate(${px + 9}px, ${py - 13}px) scale(${labelScale.toFixed(3)})`;

        const isSelC  = selCountry === key;
        const hasVis  = visibleCountrySetRef.current.has(key);
        if (selActive)        el.style.opacity = isSelC  ? '1' : '0.10';
        else if (isFiltering) el.style.opacity = hasVis  ? '0.72' : '0.10';
        else                  el.style.opacity = '0.60';
      });

      Object.entries(genreLabelEls).forEach(([genre, el]) => {
        const data     = GENRE_DATA[genre];
        const worldPos = gp(data.angle);
        const v        = worldPos.clone().project(camera);
        if (v.z > 1) { el.style.opacity = '0'; return; }

        const px = ((v.x + 1) / 2) * w;
        const py = ((-v.y + 1) / 2) * h;
        // offset label outward from ring center
        const dirX = v.x, dirY = -v.y;
        const len  = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        el.style.transform = `translate(${px + (dirX / len) * 14}px, ${py + (dirY / len) * 14 - 4}px) scale(${labelScale.toFixed(3)})`;

        const isSelG = selGenre === genre;
        const isAct  = !isFiltering || visibleGenreSetRef.current.has(genre);
        if (selActive)        el.style.opacity = isSelG ? '1' : '0.08';
        else if (isFiltering) el.style.opacity = isAct  ? '0.70' : '0.08';
        else                  el.style.opacity = '0.55';
      });

      document.body.style.cursor = (!anySelected && hoveredId) ? 'pointer' : 'default';
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      w = el.clientWidth; h = el.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      syncVisibleTubesRef.current = null;
      tubeByFilmIdRef.current.clear();
      visibleTubesRef.current = [];
      controls.dispose(); renderer.dispose(); scene.clear();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      Object.values(countryLabelEls).forEach(el => el.remove());
      Object.values(genreLabelEls).forEach(el => el.remove());
      document.body.style.cursor = 'default';
    };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, right: PANEL_W }}>
      <div ref={canvasRef}  style={{ position: 'absolute', inset: 0 }} />
      <div ref={overlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} />
    </div>
  );
}

// ── FilterPanel ───────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 7px', fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTE_CSS }}>
      {children}
    </p>
  );
}

function FilterPanel({
  searchQuery, setSearchQuery,
  activeGenres, toggleGenre,
  activeCountries, toggleCountry,
  visibleCount, visibleCountryCounts, onSelectFilm, clearFilters,
}: {
  searchQuery: string; setSearchQuery: (v: string) => void;
  activeGenres: Set<string>; toggleGenre: (id: string) => void;
  activeCountries: Set<string>; toggleCountry: (id: string) => void;
  visibleCount: number; onSelectFilm: (id: string) => void;
  visibleCountryCounts: Record<string, number>;
  clearFilters: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const q = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return [];
    return FILMS.filter(f =>
      f.title.toLowerCase().includes(q) ||
      f.director.toLowerCase().includes(q) ||
      COUNTRIES[f.country]?.label.toLowerCase().includes(q) ||
      f.genre.toLowerCase().includes(q)
    );
  }, [q]);
  const showDropdown     = q.length > 0;
  const hasActiveFilters = activeGenres.size > 0 || activeCountries.size > 0 || searchQuery.length > 0;

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: PANEL_W,
      background: 'rgba(239,236,230,0.94)',
      backdropFilter: 'blur(24px) saturate(1.05)',
      WebkitBackdropFilter: 'blur(24px) saturate(1.05)',
      borderLeft: '0.5px solid rgba(38,32,26,0.07)',
      display: 'flex', flexDirection: 'column',
      pointerEvents: 'auto', zIndex: 20,
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '52px 18px 16px' }}>

        {/* Search */}
        <div style={{ marginBottom: 22 }}>
          <SectionLabel>搜索</SectionLabel>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'rgba(38,32,26,0.05)', borderRadius: 3, padding: '7px 10px',
          }}>
            <Search size={11} strokeWidth={1.4} style={{ color: MUTE_CSS, flexShrink: 0 }} />
            <input
              ref={inputRef} type="text" placeholder="影片、导演…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="placeholder:text-[#B4ADA4]"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: '#1C1814', letterSpacing: '0.01em' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 1 }}>
                <X size={10} strokeWidth={1.8} style={{ color: MUTE_CSS }} />
              </button>
            )}
          </div>
          <AnimatePresence>
            {showDropdown && (
              <motion.div
                key="dd" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14 }}
                style={{
                  background: 'rgba(237,234,228,0.98)', backdropFilter: 'blur(16px)',
                  borderTop: 'none',
                  borderRight: '0.5px solid rgba(38,32,26,0.08)',
                  borderBottom: '0.5px solid rgba(38,32,26,0.08)',
                  borderLeft: '0.5px solid rgba(38,32,26,0.08)',
                  borderRadius: '0 0 3px 3px', overflow: 'hidden', marginTop: 1,
                }}
              >
                {searchResults.length === 0 ? (
                  <div style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 11, color: MUTE_CSS }}>「{searchQuery.trim()}」无搜索结果</span>
                  </div>
                ) : searchResults.map((f, i) => (
                  <button key={f.id} onClick={() => { onSelectFilm(f.id); setSearchQuery(''); }}
                    style={{ display: 'flex', flexDirection: 'column', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderTop: i === 0 ? 'none' : '0.5px solid rgba(38,32,26,0.05)', transition: 'background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(38,32,26,0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: GENRE_DATA[f.genre]?.css, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: '#1C1814', letterSpacing: '0.01em' }}>{f.title}</span>
                    </span>
                    <span style={{ fontSize: 9, color: MUTE_CSS, letterSpacing: '0.04em', marginTop: 2, paddingLeft: 12 }}>
                      {f.year} · {COUNTRIES[f.country]?.cn}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Genre filter */}
        <div style={{ marginBottom: 22 }}>
          <SectionLabel>类型</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {GENRE_LIST.map(genre => {
              const gd     = GENRE_DATA[genre];
              const active = activeGenres.has(genre);
              const count  = FILM_COUNT_BY_GENRE[genre] ?? 0;
              return (
                <button key={genre} onClick={() => toggleGenre(genre)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 2, textAlign: 'left', background: active ? `${gd.css}14` : 'transparent', borderLeft: active ? `2px solid ${gd.css}` : '2px solid transparent', cursor: 'pointer', transition: 'all 0.15s' }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: gd.css, opacity: active ? 1 : 0.28, transition: 'opacity 0.15s' }} />
                  <span style={{ fontSize: 11, letterSpacing: '0.01em', color: active ? '#1A1612' : '#A09890', transition: 'color 0.15s', flex: 1 }}>{gd.cn}</span>
                  <span style={{ fontSize: 8.5, color: active ? MID_CSS : '#C8C0B8' }}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Country filter */}
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>国家</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {COUNTRY_KEYS_WITH_FILMS.map(key => {
              const cd         = COUNTRIES[key];
              const active     = activeCountries.has(key);
              const filmCount  = visibleCountryCounts[key] ?? 0;
              return (
                <button key={key} onClick={() => toggleCountry(key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px 3px 8px', borderRadius: 10, background: active ? 'rgba(38,32,26,0.12)' : 'rgba(38,32,26,0.03)', border: '0.5px solid ' + (active ? 'rgba(38,32,26,0.22)' : 'rgba(38,32,26,0.05)'), cursor: 'pointer', fontSize: 9.5, letterSpacing: '0.01em', color: active ? '#1A1612' : '#B0A8A0', transition: 'all 0.15s' }}
                >
                  {cd.cn}
                  <span style={{ fontSize: 8, color: active ? MID_CSS : '#C0B8B0', background: active ? 'rgba(38,32,26,0.08)' : 'rgba(38,32,26,0.05)', borderRadius: 8, padding: '0 4px', lineHeight: '14px', minWidth: 14, textAlign: 'center' }}>
                    {filmCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {hasActiveFilters && (
          <>
            <div style={{ height: '0.5px', background: 'rgba(38,32,26,0.06)', marginBottom: 12 }} />
            <button onClick={clearFilters}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTE_CSS }}
              onMouseEnter={e => { e.currentTarget.style.color = '#3A342C'; }}
              onMouseLeave={e => { e.currentTarget.style.color = MUTE_CSS; }}
            >
              清除筛选
            </button>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 18px', borderTop: '0.5px solid rgba(38,32,26,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTE_CSS }}>
          {visibleCount === FILMS.length ? `共 ${FILMS.length} 部` : `${visibleCount} / ${FILMS.length} 部`}
        </span>
        {visibleCount === 0 && (
          <span style={{ fontSize: 9, color: '#7A6058', letterSpacing: '0.06em' }}>无匹配</span>
        )}
      </div>
    </div>
  );
}

// ── TimelineSlider ────────────────────────────────────────────────────────────
function TimelineSlider({ yearRange, setYearRange }: {
  yearRange: [number, number];
  setYearRange: (r: [number, number]) => void;
}) {
  const trackRef    = useRef<HTMLDivElement>(null);
  const yearRangeRef = useRef(yearRange);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [startStr, setStartStr] = useState(String(yearRange[0]));
  const [endStr,   setEndStr]   = useState(String(yearRange[1]));

  useEffect(() => { yearRangeRef.current = yearRange; }, [yearRange]);
  useEffect(() => { setStartStr(String(yearRange[0])); }, [yearRange[0]]);
  useEffect(() => { setEndStr  (String(yearRange[1])); }, [yearRange[1]]);

  const yToPct = (y: number) => ((y - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;
  const pctToY = (p: number) => Math.round(MIN_YEAR + (p / 100) * (MAX_YEAR - MIN_YEAR));

  const trackPctFromEvent = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const pct = trackPctFromEvent(e.clientX);
      const y   = pctToY(pct);
      const [s, end] = yearRangeRef.current;
      if (dragging === 'start') setYearRange([Math.max(MIN_YEAR, Math.min(y, end - 1)), end]);
      else                      setYearRange([s, Math.min(MAX_YEAR, Math.max(y, s + 1))]);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',  onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  const commitStart = () => {
    const y = parseInt(startStr);
    if (!isNaN(y) && y >= MIN_YEAR && y < yearRange[1]) setYearRange([y, yearRange[1]]);
    else setStartStr(String(yearRange[0]));
  };
  const commitEnd = () => {
    const y = parseInt(endStr);
    if (!isNaN(y) && y > yearRange[0] && y <= MAX_YEAR) setYearRange([yearRange[0], y]);
    else setEndStr(String(yearRange[1]));
  };

  const startPct = yToPct(yearRange[0]);
  const endPct   = yToPct(yearRange[1]);
  const isDefault = yearRange[0] === MIN_YEAR && yearRange[1] === MAX_YEAR;

  // film distribution by year
  // tick years
  const ticks: number[] = [];
  for (let y = 1990; y <= MAX_YEAR; y += 5) ticks.push(y);

  const inputStyle: React.CSSProperties = {
    width: 40, textAlign: 'center',
    background: 'rgba(38,32,26,0.05)',
    borderTop: '0.5px solid rgba(38,32,26,0.10)',
    borderRight: '0.5px solid rgba(38,32,26,0.10)',
    borderBottom: '0.5px solid rgba(38,32,26,0.10)',
    borderLeft: '0.5px solid rgba(38,32,26,0.10)',
    borderRadius: 2, padding: '3px 4px',
    fontSize: 10, color: '#1C1814', letterSpacing: '0.03em', outline: 'none',
  };

  return (
    <div style={{ padding: '10px 52px 12px', background: 'rgba(239,236,230,0.95)', backdropFilter: 'blur(20px) saturate(1.08)', WebkitBackdropFilter: 'blur(20px) saturate(1.08)', borderTop: '0.5px solid rgba(38,32,26,0.09)' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 8, letterSpacing: '0.14em', color: MUTE_CSS }}>时间轴</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input value={startStr} onChange={e => setStartStr(e.target.value)}
            onBlur={commitStart} onKeyDown={e => e.key === 'Enter' && commitStart()} style={inputStyle} />
          <span style={{ fontSize: 10, color: MUTE_CSS }}>–</span>
          <input value={endStr} onChange={e => setEndStr(e.target.value)}
            onBlur={commitEnd} onKeyDown={e => e.key === 'Enter' && commitEnd()} style={inputStyle} />
          {!isDefault && (
            <button onClick={() => setYearRange([MIN_YEAR, MAX_YEAR])}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', display: 'flex', alignItems: 'center' }}
              title="Reset"
            >
              <X size={9} strokeWidth={1.8} style={{ color: MUTE_CSS }} />
            </button>
          )}
        </div>
      </div>

      {/* Film distribution dots */}
      <div style={{ position: 'relative', height: 9, marginBottom: 3 }}>
        {Object.entries(FILM_COUNT_BY_YEAR).map(([yrStr, count]) => {
          const y = parseInt(yrStr);
          const pct = yToPct(y);
          const inRange = y >= yearRange[0] && y <= yearRange[1];
          const size    = 3 + (count - 1) * 1.5;
          return (
            <div key={yrStr} style={{ position: 'absolute', left: `${pct}%`, bottom: 0, transform: 'translateX(-50%)', width: size, height: size, borderRadius: '50%', background: inRange ? '#5A5048' : MUTE_CSS, opacity: inRange ? 0.72 : 0.16 }} />
          );
        })}
      </div>

      {/* Slider track */}
      <div ref={trackRef} style={{ position: 'relative', height: 18, cursor: 'crosshair', userSelect: 'none' }}
        onClick={e => {
          const pct = trackPctFromEvent(e.clientX);
          const y   = pctToY(pct);
          if (Math.abs(y - yearRange[0]) <= Math.abs(y - yearRange[1])) setYearRange([Math.min(y, yearRange[1] - 1), yearRange[1]]);
          else setYearRange([yearRange[0], Math.max(y, yearRange[0] + 1)]);
        }}
      >
        {/* track bg */}
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(38,32,26,0.08)', transform: 'translateY(-50%)' }} />
        {/* active fill */}
        <div style={{ position: 'absolute', top: '50%', left: `${startPct}%`, width: `${endPct - startPct}%`, height: 2, background: '#4A4038', opacity: 0.55, transform: 'translateY(-50%)' }} />
        {/* start handle */}
        <div onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragging('start'); }}
          style={{ position: 'absolute', top: '50%', left: `${startPct}%`, transform: 'translate(-50%, -50%)', width: 10, height: 10, borderRadius: '50%', background: '#2C2218', cursor: 'ew-resize', zIndex: 3, boxShadow: '0 1px 5px rgba(0,0,0,0.28)' }} />
        {/* end handle */}
        <div onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragging('end'); }}
          style={{ position: 'absolute', top: '50%', left: `${endPct}%`, transform: 'translate(-50%, -50%)', width: 10, height: 10, borderRadius: '50%', background: '#2C2218', cursor: 'ew-resize', zIndex: 3, boxShadow: '0 1px 5px rgba(0,0,0,0.28)' }} />
        {/* year labels on handles */}
        <div style={{ position: 'absolute', top: '100%', left: `${startPct}%`, transform: 'translateX(-50%)', marginTop: 4, fontSize: 8, color: '#2A2218', letterSpacing: '0.04em', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {yearRange[0]}
        </div>
        <div style={{ position: 'absolute', top: '100%', left: `${endPct}%`, transform: 'translateX(-50%)', marginTop: 4, fontSize: 8, color: '#2A2218', letterSpacing: '0.04em', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {yearRange[1]}
        </div>
      </div>

      {/* Tick marks */}
      <div style={{ position: 'relative', height: 22, marginTop: 10 }}>
        {ticks.map(y => {
          const pct     = yToPct(y);
          const inRange = y >= yearRange[0] && y <= yearRange[1];
          return (
            <div key={y} style={{ position: 'absolute', left: `${pct}%`, top: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 0.5, height: 4, background: inRange ? 'rgba(38,32,26,0.22)' : 'rgba(38,32,26,0.08)' }} />
              <span style={{ fontSize: 7.5, letterSpacing: '0.04em', color: inRange ? MID_CSS : MUTE_CSS, marginTop: 2 }}>{y}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FilmTooltip ───────────────────────────────────────────────────────────────
function FilmTooltip({ film, x, y }: { film: Film; x: number; y: number }) {
  const gd = GENRE_DATA[film.genre];
  return (
    <div style={{
      position: 'fixed', left: x + 14, top: y - 30, pointerEvents: 'none', zIndex: 50,
      background: 'rgba(241,238,232,0.97)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderTop: `2px solid ${gd?.css ?? MUTE_CSS}`,
      borderRight: '0.5px solid rgba(38,32,26,0.09)',
      borderBottom: '0.5px solid rgba(38,32,26,0.09)',
      borderLeft: '0.5px solid rgba(38,32,26,0.09)',
      borderRadius: '0 2px 2px 2px', padding: '6px 10px', minWidth: 138,
      boxShadow: '0 4px 16px rgba(0,0,0,0.07)',
    }}>
      <div style={{ fontSize: 12, color: '#1C1814', letterSpacing: '0.01em' }}>{film.title}</div>
      <div style={{ fontSize: 9, color: MUTE_CSS, letterSpacing: '0.04em', marginTop: 2 }}>
        {film.year} · {COUNTRIES[film.country]?.cn}
      </div>
    </div>
  );
}

// ── DetailCard ────────────────────────────────────────────────────────────────
function DetailCard({ film, index, total, onPrev, onNext, onClose }: {
  film: Film; index: number; total: number;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const gd           = GENRE_DATA[film.genre];
  const countryLabel = COUNTRIES[film.country]?.cn ?? film.country;

  return (
    <div style={{ width: 248, position: 'relative', background: 'rgba(242,239,233,0.98)', backdropFilter: 'blur(28px) saturate(1.05)', WebkitBackdropFilter: 'blur(28px) saturate(1.05)', border: '0.5px solid rgba(38,32,26,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.05), 0 8px 32px rgba(0,0,0,0.07)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: 1.5, background: gd?.css ?? MUTE_CSS, opacity: 1 }} />
      <button onClick={onClose}
        style={{ position: 'absolute', top: 11, right: 11, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 2, color: MUTE_CSS }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(38,32,26,0.06)'; e.currentTarget.style.color = MID_CSS; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = MUTE_CSS; }}
        aria-label="Close"
      >
        <X size={10} strokeWidth={1.5} />
      </button>
      <div style={{ padding: '13px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
          <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 1, fontSize: 7.5, letterSpacing: '0.06em', color: gd?.css ?? MID_CSS, background: `${gd?.css ?? '#888'}1A` }}>{gd?.cn ?? film.genre}</span>
          <span style={{ fontSize: 8.5, letterSpacing: '0.04em', color: MUTE_CSS }}>{countryLabel}</span>
          <span style={{ fontSize: 8.5, color: MUTE_CSS, marginLeft: 'auto', paddingRight: 16 }}>{film.year}</span>
        </div>
        <h2 style={{ margin: '0 0 4px', fontSize: 19, lineHeight: 1.1, color: '#1C1814', letterSpacing: '-0.015em', fontWeight: 400, paddingRight: 14 }}>{film.title}</h2>
        <p style={{ margin: '0 0 11px', fontSize: 10.5, color: MUTE_CSS, letterSpacing: '0.01em' }}>{film.director}</p>
        <div style={{ height: '0.5px', background: 'rgba(38,32,26,0.07)', marginBottom: 11 }} />
        <p style={{ margin: '0 0 11px', fontSize: 11, lineHeight: 1.68, color: '#5E5650' }}>{film.note}</p>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1px', marginBottom: 11, background: 'rgba(38,32,26,0.055)', borderRadius: 2, overflow: 'hidden' }}>
          {[
            { label: '制作公司', value: film.studio },
            { label: 'IMDb',     value: String(film.rating) },
            { label: '票房',     value: film.boxOffice },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'rgba(242,239,233,0.72)', padding: '6px 7px' }}>
              <div style={{ fontSize: 7, letterSpacing: '0.07em', color: MUTE_CSS, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 10, color: '#1C1814', letterSpacing: '0.01em', lineHeight: 1.3 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 8.5, letterSpacing: '0.14em', color: MUTE_CSS }}>
            {String(index + 1).padStart(2, '0')}&thinsp;/&thinsp;{String(total).padStart(2, '0')}
          </span>
          <div style={{ display: 'flex', gap: 0 }}>
            {[{ label: 'Previous', Icon: ChevronLeft, fn: onPrev }, { label: 'Next', Icon: ChevronRight, fn: onNext }].map(({ label, Icon, fn }) => (
              <button key={label} onClick={fn} aria-label={label}
                style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: MUTE_CSS, borderRadius: 2 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(38,32,26,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <Icon size={11} strokeWidth={1.6} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GenreLegend ───────────────────────────────────────────────────────────────
function GenreLegend() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 22px' }}>
      {Object.entries(GENRE_DATA).map(([genre, gd]) => (
        <div key={genre} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: gd.css, opacity: 0.72, flexShrink: 0 }} />
          <span style={{ fontSize: 9, letterSpacing: '0.06em', color: MUTE_CSS }}>{gd.cn}</span>
        </div>
      ))}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedFilmId,  setSelectedFilmId]  = useState<string | null>(null);
  const [hoveredFilmId,   setHoveredFilmId]   = useState<string | null>(null);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [activeGenres,    setActiveGenres]    = useState<Set<string>>(new Set());
  const [activeCountries, setActiveCountries] = useState<Set<string>>(new Set());
  const [yearRange,       setYearRange]       = useState<[number, number]>([MIN_YEAR, MAX_YEAR]);
  const [mousePos,        setMousePos]        = useState({ x: 0, y: 0 });
  const sceneResetRef = useRef<(() => void) | null>(null);

  const toggleGenre   = useMemo(() => toggleSet(setActiveGenres),   []);
  const toggleCountry = useMemo(() => toggleSet(setActiveCountries), []);

  const clearFilters = () => {
    setSearchQuery('');
    setActiveGenres(new Set());
    setActiveCountries(new Set());
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visibleFilms = useMemo(() => {
    return FILMS.filter(f => {
      if (f.year < yearRange[0] || f.year > yearRange[1]) return false;
      if (activeGenres.size > 0 && !activeGenres.has(f.genre)) return false;
      if (activeCountries.size > 0 && !activeCountries.has(f.country)) return false;
      if (normalizedQuery) {
        const hit = f.title.toLowerCase().includes(normalizedQuery)
          || f.director.toLowerCase().includes(normalizedQuery)
          || COUNTRIES[f.country]?.label.toLowerCase().includes(normalizedQuery)
          || f.genre.toLowerCase().includes(normalizedQuery);
        if (!hit) return false;
      }
      return true;
    });
  }, [yearRange, normalizedQuery, activeGenres, activeCountries]);

  const visibleFilmIds = useMemo(() => visibleFilms.map(f => f.id), [visibleFilms]);
  const visibleFilmSet = useMemo(() => new Set(visibleFilmIds), [visibleFilmIds]);
  const visibleGenreSet = useMemo(() => new Set(visibleFilms.map(f => f.genre)), [visibleFilms]);
  const visibleCountryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const film of visibleFilms) counts[film.country] = (counts[film.country] ?? 0) + 1;
    return counts;
  }, [visibleFilms]);
  const visibleCountrySet = useMemo(() => new Set(Object.keys(visibleCountryCounts)), [visibleCountryCounts]);
  const visibleFilmIndexById = useMemo(() => new Map(visibleFilms.map((film, index) => [film.id, index] as const)), [visibleFilms]);

  // Clear selection when the selected film is filtered out, so all visible arcs show
  useEffect(() => {
    if (selectedFilmId !== null && !visibleFilmSet.has(selectedFilmId)) {
      setSelectedFilmId(null);
    }
  }, [selectedFilmId, visibleFilmSet]);

  const selectedFilm   = selectedFilmId ? (FILM_BY_ID.get(selectedFilmId) ?? null) : null;
  const selectedIndex  = selectedFilmId ? (visibleFilmIndexById.get(selectedFilmId) ?? -1) : -1;
  const hoveredFilm    = (!selectedFilmId && hoveredFilmId) ? (FILM_BY_ID.get(hoveredFilmId) ?? null) : null;

  const selectNext = () => {
    if (!visibleFilms.length) return;
    const i = selectedIndex < 0 ? -1 : selectedIndex;
    setSelectedFilmId(visibleFilms[(i + 1 + visibleFilms.length) % visibleFilms.length].id);
  };
  const selectPrev = () => {
    if (!visibleFilms.length) return;
    const i = selectedIndex < 0 ? 0 : selectedIndex;
    setSelectedFilmId(visibleFilms[(i - 1 + visibleFilms.length) % visibleFilms.length].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     setSelectedFilmId(null);
      if (e.key === 'ArrowRight') selectNext();
      if (e.key === 'ArrowLeft')  selectPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleFilms, selectedFilmId]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const isSelected = !!selectedFilmId;

  return (
    <div className="relative w-full h-screen overflow-hidden select-none" style={{ background: BG_CSS }}>

      <ThreeScene
        selectedFilmId={selectedFilmId}
        onSelect={setSelectedFilmId}
        visibleFilmIds={visibleFilmIds}
        visibleFilmSet={visibleFilmSet}
        visibleGenreSet={visibleGenreSet}
        visibleCountrySet={visibleCountrySet}
        onHover={setHoveredFilmId}
        resetRef={sceneResetRef}
        activeCountries={activeCountries}
      />

      {/* Header — top-left */}
      <div style={{ position: 'absolute', top: 48, left: 48, zIndex: 20, pointerEvents: 'none' }}>
        <motion.div animate={{ opacity: isSelected ? 0.38 : 1 }} transition={{ duration: 0.5, ease: 'easeInOut' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: MID_CSS, display: 'block' }} />
            <span style={{ fontSize: 9, letterSpacing: '0.16em', color: MUTE_CSS }}>
              影片总数 {FILMS.length} 部
            </span>
            <span style={{ fontSize: 9, letterSpacing: '0.16em', color: MUTE_CSS }}>
              时间跨度 {FILM_YEAR_MIN}–{FILM_YEAR_MAX} · {FILM_YEAR_SPAN} 年
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.18, color: '#1A1612', letterSpacing: '-0.01em', fontWeight: 400, maxWidth: 260 }}>
            全球电影数据的空间化探索原型
          </h1>
        </motion.div>
      </div>

      {/* Bottom-left: legend ↔ detail card — sits above timeline */}
      <div style={{ position: 'absolute', bottom: 116, left: 48, zIndex: 20 }}>
        <AnimatePresence mode="wait">
          {selectedFilm ? (
            <motion.div key={selectedFilm.id}
              initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
              exit={{    opacity: 0, y: 6,  filter: 'blur(2px)' }}
              transition={{ duration: 0.4, ease: [0.22, 0.68, 0.0, 1.0] }}
              style={{ pointerEvents: 'auto' }}
            >
              <DetailCard
                film={selectedFilm}
                index={selectedIndex < 0 ? 0 : selectedIndex}
                total={visibleFilms.length || 1}
                onPrev={selectPrev} onNext={selectNext}
                onClose={() => setSelectedFilmId(null)}
              />
            </motion.div>
          ) : (
            <motion.div key="legend"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }} style={{ pointerEvents: 'none' }}
            >
              <GenreLegend />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hint — bottom-right of globe area */}
      <motion.div
        style={{ position: 'absolute', bottom: 122, right: PANEL_W + 18, zIndex: 20, pointerEvents: 'none' }}
        animate={{ opacity: isSelected ? 0 : 0.7 }}
        transition={{ duration: 0.4 }}
      >
        <span style={{ fontSize: 9, letterSpacing: '0.1em', color: MUTE_CSS }}>
          点击路径以聚焦
        </span>
      </motion.div>

      {/* Reset view button — top-right of globe area */}
      <div style={{ position: 'absolute', top: 48, right: PANEL_W + 18, zIndex: 20 }}>
        <button
          onClick={() => sceneResetRef.current?.()}
          style={{
            background: 'rgba(240,237,231,0.82)', border: '0.5px solid rgba(38,32,26,0.10)',
            borderRadius: 3, padding: '5px 10px', cursor: 'pointer',
            fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: MID_CSS,
            display: 'flex', alignItems: 'center', gap: 5,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,237,231,0.98)'; e.currentTarget.style.color = '#1C1814'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(240,237,231,0.82)'; e.currentTarget.style.color = MID_CSS; }}
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 2A5 5 0 1 0 11 6.5" />
            <polyline points="10.5 2 10.5 5.5 7 5.5" />
          </svg>
          重置视角
        </button>
      </div>

      {/* Timeline slider — flush bottom, spans globe area */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: PANEL_W, zIndex: 20, pointerEvents: 'auto' }}>
        <TimelineSlider yearRange={yearRange} setYearRange={setYearRange} />
      </div>

      {/* Filter panel — right side */}
      <FilterPanel
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        activeGenres={activeGenres} toggleGenre={toggleGenre}
        activeCountries={activeCountries} toggleCountry={toggleCountry}
        visibleCount={visibleFilmIds.length}
        visibleCountryCounts={visibleCountryCounts}
        onSelectFilm={setSelectedFilmId}
        clearFilters={clearFilters}
      />

      {/* Hover tooltip */}
      <AnimatePresence>
        {hoveredFilm && (
          <motion.div key={hoveredFilm.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
            <FilmTooltip film={hoveredFilm} x={mousePos.x} y={mousePos.y} />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

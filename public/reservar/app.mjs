/**
 * Página de reservas (9.02, D-17). Sin framework: lee el slug de la URL
 * (`/reservar/:slug`) y usa la API pública `/api/public/businesses/:slug`.
 * Todas las horas en la zona del negocio (booking-core.mjs).
 */
import {
  buildGrid,
  dayLabel,
  errorMessage,
  formatCOP,
  formatDuration,
  formatLongDate,
  formatTime,
  isClosedDay,
  nextDays,
} from './booking-core.mjs';

const $ = (id) => document.getElementById(id);
const slug = decodeURIComponent(
  location.pathname.replace(/^\/reservar\/?/, '').split('/')[0] || '',
);
const API = `/api/public/businesses/${encodeURIComponent(slug)}`;
const DAYS_AHEAD = 14;

const state = {
  business: null,
  services: [], // [{ id, name, duration, price, color, category }]
  selected: new Set(), // ids de servicios
  professionals: [],
  professionalId: null, // null = cualquiera
  day: null, // YYYY-MM-DD
  step: 30,
  slotStart: null, // ISO elegido
  durationMinutes: 0,
};

/** Error de la API con su status y su cuerpo §3 (`code`, `message`). */
class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.code = body?.code;
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child);
  }
  return node;
}

function showError(error) {
  const box = $('error');
  if (!error) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.textContent = typeof error === 'string' ? error : errorMessage(error);
  box.hidden = false;
}

function setStatus(text) {
  $('status').textContent = text || '';
}

function show(id, visible = true) {
  $(id).hidden = !visible;
}

const selectedServices = () =>
  state.services.filter((s) => state.selected.has(s.id));

/* 1 · Negocio */
async function loadBusiness() {
  if (!slug) throw new ApiError(404, null);
  state.business = await api('');
  const name = state.business.name || 'Reserva tu cita';
  $('business-name').textContent = name;
  document.title = `Reservar · ${name}`;
  $('business-zone').textContent =
    `Horas en la zona del negocio (${state.business.timezone}).`;
  if (!state.business.accepting_bookings) {
    showError(
      'Este negocio no está recibiendo reservas en línea en este momento.',
    );
    return false;
  }
  return true;
}

/* 2 · Servicios */
async function loadServices() {
  const groups = await api('/services');
  const container = $('services');
  container.replaceChildren();
  state.services = [];
  if (!groups.length) {
    container.append(
      el('p', {
        class: 'empty',
        text: 'Este negocio aún no ofrece servicios en línea.',
      }),
    );
  }
  for (const group of groups) {
    container.append(el('h3', { class: 'category', text: group.category }));
    for (const service of group.services) {
      state.services.push({ ...service, category: group.category });
      const dot = el('span', { class: 'service-dot', 'aria-hidden': 'true' });
      if (/^#[0-9a-f]{3,8}$/i.test(service.color || '')) {
        dot.style.backgroundColor = service.color;
      }
      container.append(
        el(
          'button',
          {
            type: 'button',
            class: 'service',
            'aria-pressed': 'false',
            'data-id': service.id,
            onclick: () => toggleService(service.id),
          },
          dot,
          el(
            'span',
            { class: 'service-body' },
            el('span', { class: 'service-name', text: service.name }),
            el('span', {
              class: 'service-meta',
              text: `${formatDuration(service.duration)} · ${formatCOP(service.price)}`,
            }),
          ),
          el('span', { class: 'service-check', 'aria-hidden': 'true' }),
        ),
      );
    }
  }
  show('step-services');
}

function toggleService(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  for (const button of $('services').querySelectorAll('.service')) {
    const on = state.selected.has(button.dataset.id);
    button.setAttribute('aria-pressed', String(on));
    button.querySelector('.service-check').textContent = on ? '✓' : '';
  }
  const chosen = selectedServices();
  state.durationMinutes = chosen.reduce((sum, s) => sum + s.duration, 0);
  const total = chosen.reduce((sum, s) => sum + Number(s.price), 0);
  $('services-total').textContent = chosen.length
    ? `${chosen.length} servicio${chosen.length > 1 ? 's' : ''} · ${formatDuration(state.durationMinutes)} · Total ${formatCOP(total)}`
    : '';
  resetFrom('professional');
  if (chosen.length) loadProfessionals().catch(handleError);
}

/** Oculta y limpia los pasos desde `step` en adelante. */
function resetFrom(step) {
  const order = ['professional', 'day', 'time', 'client'];
  for (const name of order.slice(order.indexOf(step))) {
    show(`step-${name}`, false);
  }
  if (order.indexOf(step) <= order.indexOf('professional')) {
    state.professionalId = null;
  }
  if (order.indexOf(step) <= order.indexOf('day')) state.day = null;
  state.slotStart = null;
  showError(null);
}

/* 3 · Profesional */
async function loadProfessionals() {
  const ids = [...state.selected].join(',');
  state.professionals = await api(
    `/professionals?service_ids=${encodeURIComponent(ids)}`,
  );
  const container = $('professionals');
  container.replaceChildren();
  if (!state.professionals.length) {
    container.append(
      el('p', {
        class: 'empty',
        text: 'Nadie hace todos esos servicios juntos. Prueba con menos servicios.',
      }),
    );
    show('step-professional');
    return;
  }
  const options = [
    { id: null, name: 'Cualquiera', image: null },
    ...state.professionals,
  ];
  for (const professional of options) {
    container.append(
      el(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(professional.id === state.professionalId),
          'data-id': professional.id ?? '',
          onclick: () => chooseProfessional(professional.id),
        },
        professional.image
          ? el('img', { class: 'avatar', src: professional.image, alt: '' })
          : null,
        professional.name,
      ),
    );
  }
  show('step-professional');
  renderDays();
}

function chooseProfessional(id) {
  state.professionalId = id;
  for (const chip of $('professionals').querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String((chip.dataset.id || null) === id));
  }
  if (state.day) loadTimes().catch(handleError);
}

/* 4 · Día */
function renderDays() {
  const tz = state.business.timezone;
  const container = $('days');
  container.replaceChildren();
  for (const ymd of nextDays(new Date(), tz, DAYS_AHEAD)) {
    const label = dayLabel(ymd);
    const closed = isClosedDay(state.business.opening_hours, ymd);
    container.append(
      el(
        'button',
        {
          type: 'button',
          class: 'day',
          disabled: closed,
          'aria-pressed': String(ymd === state.day),
          'aria-label': `${label.weekday} ${label.day} de ${label.month}${closed ? ', cerrado' : ''}`,
          'data-day': ymd,
          onclick: () => chooseDay(ymd),
        },
        el('span', { class: 'day-weekday', text: label.weekday }),
        el('span', { class: 'day-number', text: label.day }),
        el('span', { class: 'day-month', text: label.month }),
      ),
    );
  }
  show('step-day');
}

function chooseDay(ymd) {
  state.day = ymd;
  for (const button of $('days').querySelectorAll('.day')) {
    button.setAttribute('aria-pressed', String(button.dataset.day === ymd));
  }
  loadTimes().catch(handleError);
}

/* 5 · Hora */
async function loadTimes() {
  state.slotStart = null;
  show('step-client', false);
  showError(null);
  setStatus('Buscando horas libres…');
  const params = new URLSearchParams({
    date: state.day,
    service_ids: [...state.selected].join(','),
    step: String(state.step),
  });
  if (state.professionalId) params.set('professional_id', state.professionalId);
  const result = await api(`/available-slots?${params}`);
  setStatus('');
  const tz = state.business.timezone;
  const blocks = buildGrid({
    ymd: state.day,
    timeZone: tz,
    openingHours: state.business.opening_hours,
    step: state.step,
    durationMinutes: result.duration_minutes,
    slots: result.slots,
  });
  const container = $('times');
  container.replaceChildren();
  if (!blocks.some((b) => b.available)) {
    container.append(
      el('p', {
        class: 'empty',
        text: 'No hay horas libres ese día. Prueba otro.',
      }),
    );
  }
  for (const block of blocks) {
    const iso = block.start.toISOString();
    container.append(
      el(
        'button',
        {
          type: 'button',
          class: 'time',
          disabled: !block.available,
          'aria-pressed': 'false',
          'aria-label': `${formatTime(block.start, tz)}, ${block.available ? 'disponible' : 'ocupado'}`,
          'data-start': iso,
          onclick: () => chooseTime(iso),
        },
        formatTime(block.start, tz),
        el('small', { text: block.available ? 'Disponible' : 'Ocupado' }),
      ),
    );
  }
  show('step-time');
}

function chooseTime(iso) {
  state.slotStart = iso;
  for (const button of $('times').querySelectorAll('.time')) {
    button.setAttribute('aria-pressed', String(button.dataset.start === iso));
  }
  const tz = state.business.timezone;
  const who =
    state.professionals.find((p) => p.id === state.professionalId)?.name ??
    'cualquier profesional';
  $('choice-summary').textContent = `${selectedServices()
    .map((s) => s.name)
    .join(
      ', ',
    )} · ${formatLongDate(iso, tz)} a las ${formatTime(iso, tz)} · con ${who}`;
  show('step-client');
  $('client-name').focus();
}

/* 6 · Datos y reserva */
async function submit(event) {
  event.preventDefault();
  showError(null);
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  if (!data.name?.trim() || !data.phone?.trim()) {
    showError('Escribe tu nombre y tu teléfono.');
    return;
  }
  const button = $('submit');
  button.disabled = true;
  setStatus('Enviando tu reserva…');
  try {
    const booking = await api('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        service_ids: [...state.selected],
        professional_id: state.professionalId,
        start: state.slotStart,
        client: {
          name: data.name.trim(),
          lastname: data.lastname?.trim() || undefined,
          phone: data.phone.trim(),
          email: data.email?.trim() || undefined,
        },
        notes: data.notes?.trim() || undefined,
        website: data.website || undefined,
      }),
    });
    renderDone(booking);
  } catch (error) {
    handleError(error);
    if (
      error.code === 'SLOT_UNAVAILABLE' ||
      error.code === 'OUTSIDE_BUSINESS_HOURS'
    ) {
      await loadTimes().catch(() => {});
      showError(error);
    }
  } finally {
    button.disabled = false;
    setStatus('');
  }
}

function renderDone(booking) {
  const tz = booking.timezone;
  const rows = [
    ['Negocio', booking.business?.name || state.business.name || ''],
    ['Día', formatLongDate(booking.start, tz)],
    [
      'Hora',
      `${formatTime(booking.start, tz)} a ${formatTime(booking.end, tz)}`,
    ],
    ['Con', booking.professional?.name || ''],
    ['Servicios', booking.services.map((s) => s.name).join(', ')],
    ['Total', formatCOP(booking.total_price)],
  ];
  $('done-summary').replaceChildren(
    ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]),
  );
  for (const id of ['services', 'professional', 'day', 'time', 'client']) {
    show(`step-${id}`, false);
  }
  show('step-done');
  $('step-done').focus();
}

function handleError(error) {
  setStatus('');
  showError(error);
}

async function start() {
  $('client-form').addEventListener('submit', submit);
  $('again').addEventListener('click', () => location.reload());
  try {
    if (await loadBusiness()) await loadServices();
  } catch (error) {
    $('business-name').textContent = 'Reserva en línea';
    handleError(error);
  } finally {
    $('app').setAttribute('aria-busy', 'false');
  }
}

start();

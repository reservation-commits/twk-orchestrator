const body = $input.first().json.body;

const reservation = body.reservation;
const previous = body.previous;

// Sem mudança real, sem e-mail (10/09): o site dispara reservation_changed mesmo quando nada mudou
// (previous == reservation). Comparamos os campos que importam; se iguais, o fluxo para aqui.
const norm = (v) => (v == null ? '' : String(v).trim());
const semMudanca = previous &&
  norm(previous.date) === norm(reservation.date) &&
  norm(previous.time).slice(0, 5) === norm(reservation.time).slice(0, 5) &&
  Number(previous.people) === Number(reservation.people) &&
  norm(previous.details) === norm(reservation.details);
if (semMudanca) return [];

// -------- DATE -> "Tue, 08 Sep 2026"
const dateObj = new Date(`${reservation.date}T00:00:00`);

const dateParts = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}).formatToParts(dateObj);

const getPart = (type) =>
  dateParts.find(p => p.type === type)?.value || '';

const formattedDate =
  `${getPart('weekday')}, ${getPart('day')} ${getPart('month')} ${getPart('year')}`;


// -------- TIME FORMATTER
function formatTime(time) {
  if (!time) return '';

  let timeObj;

  if (
    typeof time === 'string' &&
    /^\d{1,2}:\d{2}(:\d{2})?$/.test(time)
  ) {
    const [h, m] = time.split(':');
    timeObj = new Date(2000, 0, 1, Number(h), Number(m));
  } else {
    timeObj = new Date(time);
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(timeObj);
}


// -------- CURRENT TIME
const formattedTime = formatTime(reservation.time);


// -------- PREVIOUS / PROPOSED TIME
// No novo schema, o horário anterior vem em previous.time
const formattedProposedTime = formatTime(previous?.time);


// -------- PEOPLE -> "1 guest" / "4 guests"
const people = Number(reservation.people);

const formattedPeople =
  `${people} ${people === 1 ? 'guest' : 'guests'}`;


// -------- DETAILS -> default "No details."
const formattedDetails =
  reservation.details &&
  String(reservation.details).trim() !== ''
    ? String(reservation.details).trim()
    : 'No details.';


// -------- OPTIONAL: PREVIOUS VALUES
const previousPeople = Number(previous?.people);

const formattedPreviousPeople =
  previous?.people != null
    ? `${previousPeople} ${previousPeople === 1 ? 'guest' : 'guests'}`
    : '';

const formattedPreviousDetails =
  previous?.details &&
  String(previous.details).trim() !== ''
    ? String(previous.details).trim()
    : 'No details.';


return [
  {
    json: {
      formattedDate,
      formattedTime,
      formattedProposedTime,
      formattedPeople,
      formattedDetails,

      // Dados anteriores, caso sejam necessários no próximo nó
      previousDate: previous?.date || '',
      formattedPreviousDate: (() => { if (!previous?.date) return ''; const d = new Date(previous.date + 'T00:00:00'); const ps = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(d); const g = (t) => ps.find((x) => x.type === t)?.value || ''; return g('weekday') + ', ' + g('day') + ' ' + g('month') + ' ' + g('year'); })(),
      formattedPreviousTime: formatTime(previous?.time),
      formattedPreviousPeople,
      formattedPreviousDetails,
    },
  },
];
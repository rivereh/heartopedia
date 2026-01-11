const STORAGE_KEY = 'heartopia_checklist_v1'

async function loadJSON(path) {
  try {
    const res = await fetch(path)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } catch (err) {
    console.warn('Failed to load', path, err)
    return []
  }
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch (e) {
    return {}
  }
}
function saveState(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

function makeId(type, item) {
  const key = item.name || item.id || String(item)
  return `${type}:${key}`
}

let sortMode = 'default'

let showAvailableOnly = false

// Heartopia time: PST + 3 hours. PST is UTC-8, so heartopia = UTC-5
const HEARTOPIA_UTC_OFFSET = -5

function getHeartopiaMinutes() {
  const now = new Date()
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const hpMinutes = (utcMinutes + HEARTOPIA_UTC_OFFSET * 60 + 1440) % 1440
  return hpMinutes
}

function formatMinutesToTime(mins) {
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  const ampm = hh >= 12 ? 'PM' : 'AM'
  let displayHour = hh % 12
  if (displayHour === 0) displayHour = 12
  return `${displayHour}:${String(mm).padStart(2, '0')} ${ampm}`
}

function parseTimeToMinutes(tstr) {
  if (!tstr) return null
  const m = tstr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (!m) return null
  let hh = parseInt(m[1], 10)
  const mm = parseInt(m[2] || '0', 10)
  const ap = m[3].toUpperCase()
  if (ap === 'AM') {
    if (hh === 12) hh = 0
  } else {
    if (hh !== 12) hh = hh + 12
  }
  return hh * 60 + mm
}

function isAvailableNow(item) {
  if (!item || !item.time) return true
  // If weather explicitly contains Sunny, Rainy and Rainbow, treat as always available
  if (item.weather && Array.isArray(item.weather)) {
    const wset = new Set(
      item.weather.map((w) => String(w).toLowerCase().trim())
    )
    if (wset.has('sunny') && wset.has('rainy') && wset.has('rainbow'))
      return true
  }
  const txt = String(item.time).trim()
  if (/all\s*day/i.test(txt)) return true

  // support multiple ranges separated by comma or /
  const ranges = txt
    .split(/,|\//)
    .map((s) => s.trim())
    .filter(Boolean)
  const curMin = getHeartopiaMinutes()

  for (const range of ranges) {
    const parts = range.split('-').map((s) => s.trim())
    if (parts.length !== 2) continue
    const start = parseTimeToMinutes(parts[0])
    const end = parseTimeToMinutes(parts[1])
    if (start === null || end === null) continue
    if (start < end) {
      if (curMin >= start && curMin < end) return true
    } else {
      // crosses midnight
      if (curMin >= start || curMin < end) return true
    }
  }
  return false
}

function compareLevelLocationName(a, b) {
  const la = a.level === undefined ? Infinity : a.level
  const lb = b.level === undefined ? Infinity : b.level
  if (la !== lb) return la - lb
  const loca = (a.location || '').toString()
  const locb = (b.location || '').toString()
  const locCmp = loca.localeCompare(locb, undefined, { sensitivity: 'base' })
  if (locCmp !== 0) return locCmp
  const nameA = (a.name || '').toString()
  const nameB = (b.name || '').toString()
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
}

function compareLevel(a, b) {
  const la = a.level === undefined ? Infinity : a.level
  const lb = b.level === undefined ? Infinity : b.level
  if (la !== lb) return la - lb
  const nameA = (a.name || '').toString()
  const nameB = (b.name || '').toString()
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
}

function compareLocation(a, b) {
  const loca = (a.location || '').toString()
  const locb = (b.location || '').toString()
  const locCmp = loca.localeCompare(locb, undefined, { sensitivity: 'base' })
  if (locCmp !== 0) return locCmp
  const nameA = (a.name || '').toString()
  const nameB = (b.name || '').toString()
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
}

function getSorted(arr) {
  const copy = (arr || []).slice()
  if (sortMode === 'default') copy.sort(compareLevelLocationName)
  else if (sortMode === 'level') copy.sort(compareLevel)
  else if (sortMode === 'location') copy.sort(compareLocation)
  return copy
}

function renderList(containerId, items, type, state) {
  const container = document.getElementById(containerId)
  container.innerHTML = ''
  items.forEach((item) => {
    const id = makeId(type, item)
    const checked = !!state[id]

    const li = document.createElement('li')
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = checked
    cb.addEventListener('change', (e) => {
      state[id] = e.target.checked
      saveState(state)
    })

    const content = document.createElement('div')
    content.className = 'item-content'

    const title = document.createElement('div')
    title.className = 'item-title'
    title.textContent = item.name || String(item)

    const meta = document.createElement('div')
    meta.className = 'item-meta'
    const parts = []
    if (item.location) parts.push(item.location)
    if (item.time) parts.push(item.time)
    if (item.weather && Array.isArray(item.weather)) {
      const wset = new Set(
        item.weather.map((w) => String(w).toLowerCase().trim())
      )
      const hasAll =
        wset.has('sunny') && wset.has('rainy') && wset.has('rainbow')
      if (hasAll) parts.push('Any Weather')
      else parts.push(item.weather.join(', '))
    }
    if (item.level !== undefined) parts.push('Level ' + item.level)
    meta.textContent = parts.join(' • ')

    content.appendChild(title)
    content.appendChild(meta)

    li.appendChild(cb)
    li.appendChild(content)
    container.appendChild(li)
  })
}

async function init() {
  const state = loadState()
  const [fish, bugs] = await Promise.all([
    loadJSON('fish.json'),
    loadJSON('bugs.json'),
  ])

  const fishData = fish || []
  const bugsData = bugs || []

  function updateActiveButtons() {
    const map = {
      default: 'sortDefault',
      level: 'sortLevel',
      location: 'sortLocation',
    }
    Object.values(map).forEach((id) =>
      document.getElementById(id)?.classList.remove('active')
    )
    const activeId = map[sortMode] || 'sortDefault'
    document.getElementById(activeId)?.classList.add('active')
  }

  function renderLists() {
    const f = getSorted(fishData).filter((it) =>
      showAvailableOnly ? isAvailableNow(it) : true
    )
    const b = getSorted(bugsData).filter((it) =>
      showAvailableOnly ? isAvailableNow(it) : true
    )
    renderList('fishList', f, 'fish', state)
    renderList('bugsList', b, 'bugs', state)
    updateActiveButtons()
  }

  renderLists()

  const clockEl = document.getElementById('heartopiaClock')
  function updateClock() {
    const m = getHeartopiaMinutes()
    if (clockEl) clockEl.textContent = 'Heartopia: ' + formatMinutesToTime(m)
  }
  updateClock()

  document.getElementById('clearFish').addEventListener('click', () => {
    getSorted(fishData).forEach((it) => (state[makeId('fish', it)] = false))
    saveState(state)
    renderLists()
  })

  document.getElementById('clearBugs').addEventListener('click', () => {
    getSorted(bugsData).forEach((it) => (state[makeId('bugs', it)] = false))
    saveState(state)
    renderLists()
  })

  document.getElementById('sortDefault').addEventListener('click', () => {
    sortMode = 'default'
    renderLists()
  })
  document.getElementById('sortLevel').addEventListener('click', () => {
    sortMode = 'level'
    renderLists()
  })
  document.getElementById('sortLocation').addEventListener('click', () => {
    sortMode = 'location'
    renderLists()
  })

  const availCheckbox = document.getElementById('showAvailableOnly')
  if (availCheckbox) {
    availCheckbox.addEventListener('change', (e) => {
      showAvailableOnly = !!e.target.checked
      renderLists()
    })
  }

  // refresh clock every 60s and availability when filter active
  setInterval(() => {
    updateClock()
    if (showAvailableOnly) renderLists()
  }, 60_000)
}

init()

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

let showAvailableOnly = false

// per-list sort and filters
let fishSortMode = 'default'
let bugsSortMode = 'default'
let fishLocationFilter = null
let bugsLocationFilter = null
let fishSortSecondaryLevel = false
let bugsSortSecondaryLevel = false

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
  // fallback to default global behavior (not used for per-list sorting)
  const copy = (arr || []).slice()
  copy.sort(compareLevelLocationName)
  return copy
}

function getSortedByMode(arr, mode, secondaryLevel) {
  const copy = (arr || []).slice()
  copy.sort((a, b) => {
    if (mode === 'default') {
      return compareLevelLocationName(a, b)
    }
    if (mode === 'level') {
      const r = compareLevel(a, b)
      if (r !== 0) return r
      return (a.name || '').localeCompare(b.name || '', undefined, {
        sensitivity: 'base',
      })
    }
    if (mode === 'location') {
      // Always sort by location first, then by level, then by name
      const r = (a.location || '')
        .toString()
        .localeCompare((b.location || '').toString(), undefined, {
          sensitivity: 'base',
        })
      if (r !== 0) return r
      const s = compareLevel(a, b)
      if (s !== 0) return s
      return (a.name || '').localeCompare(b.name || '', undefined, {
        sensitivity: 'base',
      })
    }
    return (a.name || '').localeCompare(b.name || '', undefined, {
      sensitivity: 'base',
    })
  })
  return copy
}

function renderList(containerId, items, type, state) {
  const container = document.getElementById(containerId)
  container.innerHTML = ''
  items.forEach((item) => {
    const id = makeId(type, item)
    const checked = !!state[id]

    const li = document.createElement('li')
    if (checked) li.classList.add('collected')
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = checked
    cb.addEventListener('change', (e) => {
      state[id] = e.target.checked
      saveState(state)
      // notify listeners that state changed so UI can update (move collected, mark locations)
      try {
        document.dispatchEvent(new CustomEvent('heartopiaStateChanged'))
      } catch (err) {
        // ignore
      }
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
    // per-list level buttons
    const fBtn = document.getElementById('sortLevelFish')
    if (fBtn) {
      if (fishSortMode === 'level' || fishSortSecondaryLevel)
        fBtn.classList.add('active')
      else fBtn.classList.remove('active')
    }
    const bBtn = document.getElementById('sortLevelBugs')
    if (bBtn) {
      if (bugsSortMode === 'level' || bugsSortSecondaryLevel)
        bBtn.classList.add('active')
      else bBtn.classList.remove('active')
    }

    // per-list select reflect
    const sf = document.getElementById('sortLocationFish')
    if (sf) {
      if (fishLocationFilter) sf.value = fishLocationFilter
      else if (fishSortMode === 'location') sf.value = 'location-all'
      else sf.value = 'none'
    }
    const sb = document.getElementById('sortLocationBugs')
    if (sb) {
      if (bugsLocationFilter) sb.value = bugsLocationFilter
      else if (bugsSortMode === 'location') sb.value = 'location-all'
      else sb.value = 'none'
    }
  }

  function renderLists() {
    const fSorted = getSortedByMode(
      fishData,
      fishSortMode,
      fishSortSecondaryLevel
    )
    const f = fSorted.filter(
      (it) =>
        (showAvailableOnly ? isAvailableNow(it) : true) &&
        (fishLocationFilter ? (it.location || '') === fishLocationFilter : true)
    )
    const bSorted = getSortedByMode(
      bugsData,
      bugsSortMode,
      bugsSortSecondaryLevel
    )
    const b = bSorted.filter(
      (it) =>
        (showAvailableOnly ? isAvailableNow(it) : true) &&
        (bugsLocationFilter ? (it.location || '') === bugsLocationFilter : true)
    )
    // If hide-collected is enabled, move collected items to the bottom
    const hideCollected = !!state.hideCollected
    let fToRender = f
    if (hideCollected) {
      const un = []
      const col = []
      f.forEach((it) => {
        const id = makeId('fish', it)
        if (state[id]) col.push(it)
        else un.push(it)
      })
      fToRender = un.concat(col)
    }
    let bToRender = b
    if (hideCollected) {
      const un = []
      const col = []
      b.forEach((it) => {
        const id = makeId('bugs', it)
        if (state[id]) col.push(it)
        else un.push(it)
      })
      bToRender = un.concat(col)
    }

    renderList('fishList', fToRender, 'fish', state)
    renderList('bugsList', bToRender, 'bugs', state)

    // Update per-location completion markers in the selects
    const locFishEl = document.getElementById('sortLocationFish')
    if (locFishEl) {
      for (const opt of Array.from(locFishEl.options)) {
        const v = opt.value
        if (!v || v === 'none' || v === 'location-all') continue
        const itemsInLoc = (fishData || []).filter(
          (it) => (it.location || '') === v
        )
        const total = itemsInLoc.length
        const collected = itemsInLoc.filter(
          (it) => !!state[makeId('fish', it)]
        ).length
        opt.textContent = v + (total > 0 && collected === total ? ' ✓' : '')
      }
    }
    const locBugsEl = document.getElementById('sortLocationBugs')
    if (locBugsEl) {
      for (const opt of Array.from(locBugsEl.options)) {
        const v = opt.value
        if (!v || v === 'none' || v === 'location-all') continue
        const itemsInLoc = (bugsData || []).filter(
          (it) => (it.location || '') === v
        )
        const total = itemsInLoc.length
        const collected = itemsInLoc.filter(
          (it) => !!state[makeId('bugs', it)]
        ).length
        opt.textContent = v + (total > 0 && collected === total ? ' ✓' : '')
      }
    }
    updateActiveButtons()
  }

  renderLists()

  const clockEl = document.getElementById('heartopiaClock')
  function updateClock() {
    const m = getHeartopiaMinutes()
    if (clockEl) clockEl.textContent = 'Heartopia: ' + formatMinutesToTime(m)
  }
  updateClock()

  // Removed per-panel Clear handlers (buttons removed from HTML)
  // per-list sortLevel buttons
  const slFish = document.getElementById('sortLevelFish')
  if (slFish) {
    slFish.addEventListener('click', () => {
      // If a specific location filter is active, toggle primary level sort for the filtered list
      if (fishLocationFilter) {
        if (fishSortMode === 'level') fishSortMode = 'default'
        else fishSortMode = 'level'
        // clear secondary flag when toggling primary
        fishSortSecondaryLevel = false
      } else if (fishSortMode === 'location') {
        // if we're grouping by location (Location All), toggle secondary-level within groups
        fishSortSecondaryLevel = !fishSortSecondaryLevel
      } else {
        if (fishSortMode === 'level') {
          fishSortMode = 'default'
        } else {
          fishSortMode = 'level'
        }
        fishSortSecondaryLevel = false
      }
      renderLists()
    })
  }
  const slBugs = document.getElementById('sortLevelBugs')
  if (slBugs) {
    slBugs.addEventListener('click', () => {
      if (bugsLocationFilter) {
        if (bugsSortMode === 'level') bugsSortMode = 'default'
        else bugsSortMode = 'level'
        bugsSortSecondaryLevel = false
      } else if (bugsSortMode === 'location') {
        bugsSortSecondaryLevel = !bugsSortSecondaryLevel
      } else {
        if (bugsSortMode === 'level') {
          bugsSortMode = 'default'
        } else {
          bugsSortMode = 'level'
        }
        bugsSortSecondaryLevel = false
      }
      renderLists()
    })
  }

  // populate per-list location selects
  const locFish = document.getElementById('sortLocationFish')
  if (locFish) {
    const locSet = new Set()
    ;(fishData || []).forEach((it) => it.location && locSet.add(it.location))
    const locs = Array.from(locSet)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    locs.forEach((l) => {
      const opt = document.createElement('option')
      opt.value = l
      opt.textContent = l
      locFish.appendChild(opt)
    })
    locFish.addEventListener('change', (e) => {
      const v = e.target.value
      if (v === 'none') {
        // reset to normal/default: clear filter and revert to default sort
        fishLocationFilter = null
        fishSortMode = 'default'
        fishSortSecondaryLevel = false
      } else if (v === 'location-all') {
        // sort by location but do not filter
        fishLocationFilter = null
        fishSortMode = 'location'
      } else {
        // specific location selected -> filter to that location
        // and sort the filtered list by level by default
        fishLocationFilter = v
        fishSortMode = 'level'
        fishSortSecondaryLevel = false
      }
      renderLists()
    })
  }

  const locBugs = document.getElementById('sortLocationBugs')
  if (locBugs) {
    const locSet = new Set()
    ;(bugsData || []).forEach((it) => it.location && locSet.add(it.location))
    const locs = Array.from(locSet)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    locs.forEach((l) => {
      const opt = document.createElement('option')
      opt.value = l
      opt.textContent = l
      locBugs.appendChild(opt)
    })
    locBugs.addEventListener('change', (e) => {
      const v = e.target.value
      if (v === 'none') {
        bugsLocationFilter = null
        bugsSortMode = 'default'
        bugsSortSecondaryLevel = false
      } else if (v === 'location-all') {
        bugsLocationFilter = null
        bugsSortMode = 'location'
      } else {
        // specific location selected -> filter to that location
        // and sort the filtered list by level by default
        bugsLocationFilter = v
        bugsSortMode = 'level'
        bugsSortSecondaryLevel = false
      }
      renderLists()
    })
  }

  const availCheckbox = document.getElementById('showAvailableOnly')
  if (availCheckbox) {
    availCheckbox.addEventListener('change', (e) => {
      showAvailableOnly = !!e.target.checked
      renderLists()
    })
  }

  // hide-collected checkbox: persist in state and re-render when toggled
  const hideCheckbox = document.getElementById('hideCollected')
  if (hideCheckbox) {
    hideCheckbox.checked = !!state.hideCollected
    hideCheckbox.addEventListener('change', (e) => {
      state.hideCollected = !!e.target.checked
      saveState(state)
      renderLists()
    })
  }

  // re-render when other parts of UI update state (checkboxes inside lists)
  document.addEventListener('heartopiaStateChanged', renderLists)

  // refresh clock every 60s and availability when filter active
  setInterval(() => {
    updateClock()
    if (showAvailableOnly) renderLists()
  }, 60_000)
}

init()

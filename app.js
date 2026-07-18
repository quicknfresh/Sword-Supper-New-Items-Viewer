'use strict';

const SOURCE_BASES = [
  'https://cdn.jsdelivr.net/gh/asufyani/sword_supper_data_viewer@master/src/utils/',
  'https://raw.githubusercontent.com/asufyani/sword_supper_data_viewer/master/src/utils/'
];
const ASSET_BASE = 'https://cabbageidle-eimoap-0-0-85-webview.devvit.net';

const state = {
  items: {}, loot: {}, enemies: {}, maps: {},
  gear: [], resources: [], drops: {},
  view: 'gear', filter: 'All', query: '', sort: 'level',
  selectedFamily: null, selectedLevel: 0
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const rarityOrder = { mythic: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5 };
const rarityGradient = {
  common: 'linear-gradient(#7f8c9d,#515b67)',
  uncommon: 'linear-gradient(#45c66b,#187b37)',
  rare: 'linear-gradient(#42a5ff,#1758b8)',
  epic: 'linear-gradient(#c36cff,#6720a8)',
  legendary: 'linear-gradient(#ffcf45,#d06c00)',
  mythic: 'linear-gradient(#ff6969,#a4122d)'
};
const rarityText = { common: '#e7edf5', uncommon: '#a5ffb4', rare: '#8ed0ff', epic: '#e4afff', legendary: '#ffe266', mythic: '#ffb2b2' };
const rarityBadge = { common: '#8d9baa', uncommon: '#43a85e', rare: '#3486db', epic: '#9d52ce', legendary: '#e99b21', mythic: '#dc4d4d' };
const slotIcon = {
  Head: 'slot_icon_head.png', Hat: 'slot_icon_head.png',
  Chest: 'slot_icon_chest.png', Shirt: 'slot_icon_chest.png', Cloak: 'slot_icon_chest.png',
  Amulet: 'slot_icon_amulet.png', Weapon: 'slot_icon_weapon.png',
  Ring: 'slot_icon_ring.png', Belt: 'slot_icon_belt.png'
};
const slotBadge = {
  Head: 'slot_badge_head.png', Hat: 'slot_badge_head.png',
  Chest: 'slot_badge_chest.png', Shirt: 'slot_badge_chest.png', Cloak: 'slot_badge_chest.png',
  Amulet: 'slot_badge_amulet.png', Weapon: 'slot_badge_weapon.png',
  Ring: 'slot_badge_ring.png', Belt: 'slot_badge_belt.png'
};

function human(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
function equipBg(rarity = 'common') { return `${ASSET_BASE}/assets/ui/equip_bg_${rarity}.png`; }
function itemIcon(item) { return `${ASSET_BASE}/assets/ui/item-icons/${encodeURIComponent(item.assetName || item.id)}.png`; }
function slotAsset(slot, badge = false) {
  const file = (badge ? slotBadge : slotIcon)[slot];
  return file ? `${ASSET_BASE}/assets/ui/${file}` : '';
}

async function fetchSource(file) {
  const errors = [];
  for (const base of SOURCE_BASES) {
    try {
      const response = await fetch(base + file, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      errors.push(`${base.includes('jsdelivr') ? 'CDN' : 'GitHub'}: ${error.message}`);
    }
  }
  throw new Error(`${file} could not be loaded (${errors.join(' | ')})`);
}

function evaluateObject(source, exportName, scope = {}) {
  let text = source
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');

  const declaration = new RegExp(`export\\s+const\\s+${exportName}\\s*(?::\\s*[^=]+)?\\s*=`);
  if (!declaration.test(text)) throw new Error(`Could not find export ${exportName}`);
  text = text.replace(declaration, 'return ');
  text = text.replace(/^\s*export\s+default\s+.*$/gm, '');

  const names = Object.keys(scope);
  return Function(...names, `"use strict";\n${text}`)(...names.map((name) => scope[name]));
}

async function loadData() {
  const files = ['items.ts', 'loot.ts', 'enemies.ts', 'mapEnemies.ts'];
  const [itemsText, lootText, enemiesText, mapsText] = await Promise.all(files.map(fetchSource));
  state.items = evaluateObject(itemsText, 'items');
  state.loot = evaluateObject(lootText, 'et');
  state.enemies = evaluateObject(enemiesText, 'z3', { et: state.loot });
  state.maps = evaluateObject(mapsText, 'Z0');
  buildIndexes();
}

function rangeOf(tier) { return { min: tier.minLevel || 1, max: tier.maxLevel ?? Infinity }; }
function intersectRange(first, second) {
  if (!first) return second;
  const min = Math.max(first.min, second.min);
  const max = Math.min(first.max, second.max);
  return min <= max ? { min, max } : null;
}
function rangeLabel(range) { return Number.isFinite(range.max) ? `${range.min}–${range.max}` : `${range.min}+`; }
function weightedChance(table, tier, entry) {
  if (table.type === 'always' || table.type === 'all') return 1;
  const total = tier.items.reduce((sum, item) => sum + (item.weight || 0), 0);
  if (!total) return 1;
  return (entry.weight || 0) / total;
}
function tableObjectNames() {
  const map = new Map();
  Object.entries(state.loot).forEach(([name, object]) => map.set(object, name));
  return map;
}
function mapEnemyIndex() {
  const output = {};
  Object.entries(state.maps).forEach(([mapId, table]) => {
    (table.tiers || []).forEach((tier) => {
      const total = tier.items.reduce((sum, item) => sum + (item.weight || 0), 0);
      tier.items.forEach((entry) => {
        if (!entry.id) return;
        (output[entry.id] ||= []).push({
          mapId,
          levels: rangeLabel(rangeOf(tier)),
          chance: total ? (entry.weight || 0) / total : 1
        });
      });
    });
  });
  return output;
}

function buildIndexes() {
  const lootNameByObject = tableObjectNames();
  const enemyMaps = mapEnemyIndex();
  const enemiesByTable = {};

  Object.entries(state.enemies).forEach(([enemyId, enemy]) => {
    (enemy.lootTables || []).forEach((tableObject) => {
      const tableName = lootNameByObject.get(tableObject);
      if (!tableName) return;
      (enemiesByTable[tableName] ||= []).push({
        id: enemyId,
        name: enemy.name || human(enemyId),
        maps: enemyMaps[enemyId] || []
      });
    });
  });

  state.drops = {};
  function walk(tableName, probability = 1, trail = [], root = tableName, activeRange = null) {
    if (trail.includes(tableName) || trail.length > 8) return;
    const table = state.loot[tableName];
    if (!table) return;
    const nextTrail = [...trail, tableName];

    (table.tiers || []).forEach((tier) => {
      const effectiveRange = intersectRange(activeRange, rangeOf(tier));
      if (!effectiveRange) return;
      tier.items.forEach((entry) => {
        const chance = weightedChance(table, tier, entry);
        const combined = probability * chance;
        if (entry.id) {
          (state.drops[entry.id] ||= []).push({
            root, table: tableName, chance: combined, quantity: entry.quantity,
            range: effectiveRange, trail: nextTrail,
            enemies: enemiesByTable[root] || enemiesByTable[tableName] || []
          });
        } else if (entry.tableId) {
          walk(entry.tableId, combined, nextTrail, root, effectiveRange);
        }
      });
    });
  }
  Object.keys(state.loot).forEach((tableName) => walk(tableName));

  Object.keys(state.drops).forEach((itemId) => {
    const unique = new Map();
    state.drops[itemId].forEach((drop) => {
      const key = [drop.root, drop.table, rangeLabel(drop.range), drop.chance.toFixed(10), JSON.stringify(drop.quantity), drop.trail.join('>')].join('|');
      unique.set(key, drop);
    });
    state.drops[itemId] = [...unique.values()];
  });

  const upgradedIds = new Set();
  const resourceIds = new Set();
  Object.values(state.items).forEach((item) => {
    (item.upgrades || []).forEach((upgrade) => {
      if (upgrade.yields) upgradedIds.add(upgrade.yields);
      (upgrade.requires || []).forEach((requirement) => resourceIds.add(requirement.id));
    });
  });

  state.gear = Object.values(state.items)
    .filter((item) => item.tags?.includes('equipment') && !upgradedIds.has(item.id))
    .sort(compareLevelName);

  state.resources = [...resourceIds]
    .map((id) => state.items[id] || ({ id, name: human(id), rarity: 'common', tags: ['resource'], description: 'Upgrade material' }))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  $('#status').textContent = `${state.gear.length} gear families · ${state.resources.length} resources`;
  $('#status').classList.remove('loading', 'error');
  render();
}

function compareLevelName(a, b) {
  return (a.requiredLevel || 0) - (b.requiredLevel || 0) || (a.name || '').localeCompare(b.name || '');
}
function familyFor(base) {
  const family = [base];
  const seen = new Set([base.id]);
  let current = base;
  while (current?.upgrades?.[0]?.yields && !seen.has(current.upgrades[0].yields)) {
    const next = state.items[current.upgrades[0].yields];
    if (!next) break;
    seen.add(next.id);
    family.push(next);
    current = next;
  }
  return family;
}
function filterSlots() {
  const preferred = ['Weapon', 'Head', 'Chest', 'Amulet', 'Ring', 'Belt', 'Cloak', 'Shirt', 'Hat'];
  const found = new Set(state.gear.flatMap((item) => item.equipSlots || []));
  return ['All', ...preferred.filter((slot) => found.has(slot)), ...[...found].filter((slot) => !preferred.includes(slot)).sort()];
}

function renderFilters() {
  const filters = state.view === 'gear' ? filterSlots() : ['All', 'Has drops', 'No direct drops'];
  $('#filters').innerHTML = filters.map((filter) => {
    const icon = state.view === 'gear' && filter !== 'All' ? slotAsset(filter) : '';
    return `<button class="filter-button${state.filter === filter ? ' active' : ''}" data-filter="${esc(filter)}" title="${esc(filter)}">${icon ? `<img src="${icon}" alt="">` : esc(filter.toUpperCase())}</button>`;
  }).join('');
  document.querySelectorAll('.filter-button').forEach((button) => {
    button.addEventListener('click', () => { state.filter = button.dataset.filter; render(); });
  });
}
function filteredRows() {
  const query = state.query.trim().toLowerCase();
  let rows = state.view === 'gear' ? [...state.gear] : [...state.resources];
  rows = rows.filter((item) => {
    const searchable = `${item.name || ''} ${item.id || ''} ${(item.equipSlots || []).join(' ')} ${item.description || ''}`.toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (state.view === 'gear' && state.filter !== 'All' && !item.equipSlots?.includes(state.filter)) return false;
    const hasDrops = Boolean(state.drops[item.id]?.length);
    if (state.view === 'resources' && state.filter === 'Has drops' && !hasDrops) return false;
    if (state.view === 'resources' && state.filter === 'No direct drops' && hasDrops) return false;
    return true;
  });
  if (state.sort === 'name') rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (state.sort === 'level') rows.sort(compareLevelName);
  if (state.sort === 'rarity') rows.sort((a, b) => (rarityOrder[a.rarity] ?? 99) - (rarityOrder[b.rarity] ?? 99) || compareLevelName(a, b));
  return rows;
}
function render() {
  renderFilters();
  const rows = filteredRows();
  $('#searchInput').placeholder = state.view === 'gear' ? 'Search all gear…' : 'Search resources…';
  $('#summary').textContent = `${rows.length} shown · ${state.view === 'gear' ? 'complete gear families' : 'upgrade materials and drop lookup'}`;
  $('#itemGrid').innerHTML = rows.length ? rows.map(renderCard).join('') : '<div class="empty-message">No matching entries.</div>';
  document.querySelectorAll('.item-card').forEach((card) => card.addEventListener('click', () => openItem(card.dataset.id)));
}
function renderCard(item) {
  const slot = state.view === 'gear' ? (item.equipSlots?.[0] || '') : '';
  const badge = slot && slotAsset(slot, true) ? `<span class="slot-badge" style="background:${rarityBadge[item.rarity] || '#8d9baa'}"><img src="${slotAsset(slot, true)}" alt=""></span>` : '';
  const meta = state.view === 'gear' ? `Lv ${item.requiredLevel || 1}` : `${state.drops[item.id]?.length || 0} drop route${state.drops[item.id]?.length === 1 ? '' : 's'}`;
  return `<button class="item-card" data-id="${esc(item.id)}" title="${esc(item.name || human(item.id))}">
    <span class="equipment-slot" style="background-image:url('${equipBg(item.rarity)}')">
      ${badge}<span class="item-image-container"><img class="item-image" src="${itemIcon(item)}" alt="" onerror="this.style.display='none';this.nextElementSibling.classList.add('show')"><span class="resource-fallback">◆</span></span>
    </span>
    <span class="item-label">${esc(item.name || human(item.id))}<br><small>${esc(meta)}</small></span>
  </button>`;
}

function statText(stat) {
  let value = stat.value;
  if (typeof value === 'number' && Math.abs(value) <= 1 && /Crit|Dodge|Resist|Chance|SpeedMultiplier/i.test(stat.stat)) value = `${Number((value * 100).toFixed(2))}%`;
  return `${human(stat.stat)}: ${value}`;
}
function abilityText(ability) {
  if (!ability) return '';
  const params = ability.params && Object.keys(ability.params).length ? ` (${Object.entries(ability.params).map(([key, value]) => `${human(key)}: ${typeof value === 'number' && Math.abs(value) <= 1 ? `${Number((value * 100).toFixed(2))}%` : value}`).join(', ')})` : '';
  return `${human(ability.id)}${params}`;
}
function levelLabel(item, index, total) {
  const match = (item.name || '').match(/(?:Lvl|Lv)\s*(\d+)/i);
  if (match) return `Lvl ${match[1]}`;
  if (/Ultimate/i.test(item.name || '')) return 'Ultimate';
  if (/EX\b/i.test(item.name || '')) return 'EX';
  return total === 1 ? 'Base' : `Level ${index + 1}`;
}
function qtyLabel(quantity) { return Array.isArray(quantity) ? quantity.join('–') : (quantity ?? 1); }
function sourceLabel(drop) {
  const enemies = drop.enemies || [];
  if (!enemies.length) return human(drop.root || drop.table);
  const enemyNames = [...new Set(enemies.map((enemy) => enemy.name))];
  const maps = [...new Set(enemies.flatMap((enemy) => enemy.maps.map((map) => human(map.mapId))))];
  return `${enemyNames.join(', ')}${maps.length ? ` · ${maps.join(', ')}` : ''}`;
}
function dropRows(itemId) {
  const drops = [...(state.drops[itemId] || [])].sort((a, b) => b.chance - a.chance);
  if (!drops.length) return '<div class="farm-row">No direct loot-table drop was found. It may be crafted, upgraded, quest-gated, or granted elsewhere.</div>';
  return drops.map((drop) => `<div class="farm-row"><strong>${esc(sourceLabel(drop))}</strong><br>Applicable level: ${esc(rangeLabel(drop.range))} · Quantity: ${esc(qtyLabel(drop.quantity))}<br>Conditional chance: <span class="farm-chance">${(drop.chance * 100).toFixed(3)}%</span><div class="farm-meta">Route: ${esc(drop.trail.map(human).join(' → '))}</div></div>`).join('');
}

function openItem(itemId) {
  const item = state.items[itemId] || state.resources.find((entry) => entry.id === itemId);
  if (!item) return;
  state.selectedFamily = item.tags?.includes('equipment') ? familyFor(item) : [item];
  state.selectedLevel = 0;
  renderModal();
  $('#detailOverlay').classList.add('open');
}
function renderModal() {
  const family = state.selectedFamily;
  const item = family[state.selectedLevel];
  const isGear = item.tags?.includes('equipment');
  const rarity = item.rarity || 'common';

  $('#modalHeader').style.background = rarityGradient[rarity] || rarityGradient.common;
  $('#modalName').textContent = item.name || human(item.id);
  $('#modalRarity').textContent = isGear ? rarity : 'resource';
  $('#modalRarity').style.color = rarityText[rarity] || '#fff';
  $('#modalLevel').textContent = isGear ? `Min Level: ${item.requiredLevel || 1}` : `${state.drops[item.id]?.length || 0} drop routes`;
  $('#modalIcon').style.backgroundImage = `url("${equipBg(rarity)}")`;
  $('#modalIcon').innerHTML = `<img src="${itemIcon(item)}" alt="" onerror="this.style.display='none'">`;

  $('#levelSelector').innerHTML = family.length > 1 ? family.map((entry, index) => `<button class="level-button${index === state.selectedLevel ? ' active' : ''}" data-level="${index}">${esc(levelLabel(entry, index, family.length))}</button>`).join('') : '';
  document.querySelectorAll('.level-button').forEach((button) => button.addEventListener('click', () => { state.selectedLevel = Number(button.dataset.level); renderModal(); }));

  $('#modalBody').innerHTML = isGear ? gearBody(item) : resourceBody(item);
  document.querySelectorAll('.resource-chip[data-id]').forEach((button) => button.addEventListener('click', () => openItem(button.dataset.id)));
}
function gearBody(item) {
  const stats = [
    ...(item.damage ? Object.entries(item.damage).map(([type, value]) => `${human(type)} Damage: ${value}`) : []),
    ...(item.statModifiers || []).map(statText)
  ];
  const abilities = (item.abilities || []).map(abilityText).filter(Boolean);
  const requirements = item.upgrades?.[0]?.requires || [];
  return `<p class="description">${esc(item.description || '')}</p>
    <div class="section-title">Stats</div>${stats.length ? stats.map((text) => `<div class="stat-row">${esc(text)}</div>`).join('') : '<div class="stat-row">No stat modifiers</div>'}
    ${abilities.length ? `<div class="section-title">Abilities</div>${abilities.map((text) => `<div class="ability-row">${esc(text)}</div>`).join('')}` : ''}
    <div class="section-title">Upgrade Requirements</div><div class="resource-row">${requirements.length ? requirements.map((requirement) => `<button class="resource-chip" data-id="${esc(requirement.id)}">${esc(requirement.amount)} ${esc(state.items[requirement.id]?.name || human(requirement.id))}</button>`).join('') : '<span class="resource-chip">Final version</span>'}</div>
    <div class="section-title">Where to Farm This Version</div>${dropRows(item.id)}
    <div class="section-title">Sell Price</div><div class="stat-row"><strong>${esc(item.sellPrice ?? 0)}</strong> coins</div>
    <p class="note">Percentages are calculated from the published loot-table weights. Nested table chances are multiplied together; event or mission selection outside those tables may reduce the overall per-run chance.</p>`;
}
function resourceBody(item) {
  const requiredBy = Object.values(state.items).filter((gear) => gear.upgrades?.some((upgrade) => upgrade.requires?.some((requirement) => requirement.id === item.id)));
  return `<p class="description">${esc(item.description || 'Upgrade material')}</p>
    <div class="section-title">Drop Locations and Probabilities</div>${dropRows(item.id)}
    <div class="section-title">Used to Upgrade</div><div class="used-grid">${requiredBy.length ? requiredBy.slice(0, 150).map((gear) => `<span class="used-chip">${esc(gear.name)}</span>`).join('') : '<span class="used-chip">No upgrade usage found</span>'}</div>
    <p class="note">A percentage shown here is conditional on reaching the displayed loot table and level tier.</p>`;
}

function setView(view) {
  state.view = view;
  state.filter = 'All';
  document.querySelectorAll('.category-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  render();
}

document.querySelectorAll('.category-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#searchInput').addEventListener('input', (event) => { state.query = event.target.value; render(); });
$('#sortButton').addEventListener('click', () => {
  const modes = ['level', 'rarity', 'name'];
  state.sort = modes[(modes.indexOf(state.sort) + 1) % modes.length];
  $('#sortButton').textContent = { level: 'Sort: Level', rarity: 'Sort: Rarity', name: 'Sort: A–Z' }[state.sort];
  render();
});
$('#minimizeButton').addEventListener('click', () => {
  $('#inventoryShell').classList.toggle('minimized');
  $('#minimizeButton').textContent = $('#inventoryShell').classList.contains('minimized') ? '+' : 'X';
});
$('#detailClose').addEventListener('click', () => $('#detailOverlay').classList.remove('open'));
$('#detailOverlay').addEventListener('click', (event) => { if (event.target === $('#detailOverlay')) $('#detailOverlay').classList.remove('open'); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('#detailOverlay').classList.remove('open'); });

loadData().catch((error) => {
  console.error(error);
  $('#status').textContent = `Data load failed: ${error.message}`;
  $('#status').classList.remove('loading');
  $('#status').classList.add('error');
  $('#itemGrid').innerHTML = `<div class="empty-message">Could not load the game database.<br><small>${esc(error.message)}</small></div>`;
  $('#summary').textContent = 'Loader error';
});

#!/usr/bin/env python3
"""Generate data/catalog.js for Craft Ledger from ao-bin-dumps items.json.

Extracts craftable items (weapons, armor, off-hands, tools, mounts, food,
potions, bags, capes, refined materials) for tiers 2-8, excluding
artifact-based variants, plus the ingredient price list (raw materials,
herbs, crops, animals, runes/souls/relics, ...).
"""
import json, re, sys, datetime
from collections import OrderedDict

SRC = 'items.json'
FMT = 'items_fmt.json'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'catalog.js'

dump = json.load(open(SRC))['items']
fmt = json.load(open(FMT))

def as_list(v):
    if v is None: return []
    return v if isinstance(v, list) else [v]

# ---------------- localized names ----------------
NAMES = {}
for x in fmt:
    un = x.get('UniqueName')
    nm = (x.get('LocalizedNames') or {}).get('EN-US')
    if un and nm:
        NAMES[un] = nm

def base_name(uid):
    """EN name for a dump uniquename (no @). Falls back to uid."""
    if uid in NAMES:
        return NAMES[uid]
    m = re.search(r'_LEVEL(\d)$', uid)
    if m and (uid + '@' + m.group(1)) in NAMES:
        return NAMES[uid + '@' + m.group(1)]
    return NAMES.get(uid + '@1') or uid

# ---------------- category rules ----------------
MELEE = {'sword','axe','mace','hammer','spear','dagger','quarterstaff','knuckles'}
RANGED = {'bow','crossbow'}
MAGIC = {'firestaff','froststaff','arcanestaff','holystaff','naturestaff','cursestaff','shapeshifterstaff'}

# name-based hard excludes (artifact lines are also caught by ingredient rule,
# this is belt & braces + non-market stuff)
EXCLUDE_RE = re.compile(r'(_AVALON|_ROYAL|_CRYSTAL|_BP$|CAPEITEM|_SKIN|VANITY|_BABY$|QUESTITEM|UNIQUE_|_FACTION_'
                        r'|_UNDEAD|_KEEPER|_MORGANA|_HELL\b|_HELL_|_DEMON|_HERETIC|_FEY|_PROTOTYPE)')

def tier_of(it):
    t = it.get('@tier')
    try: return int(t)
    except (TypeError, ValueError): return None

def is_artifact_ingredient(uid):
    return uid.startswith('ARTEFACT') or 'ARTEFACT' in uid

# ---------------- collect ingredient universe ----------------
# priceable-on-market items that are inputs only
ingredients = {}   # uid -> {name, tier, kind}

def add_ing(uid, kind, tier=None):
    if uid not in ingredients:
        ingredients[uid] = {'name': base_name(uid), 'kind': kind, 'tier': tier}

for it in as_list(dump['simpleitem']):
    uid = it['@uniquename']; cat = it.get('@shopcategory'); sub = it.get('@shopsubcategory1')
    t = tier_of(it)
    if cat == 'crafting' and sub == 'resources':
        add_ing(uid, 'raw', t)
    elif cat == 'crafting' and sub == 'alchemy':
        add_ing(uid, 'herb', t)
    elif cat == 'farming' and sub in ('farmingproducts', 'farm', 'pasture'):
        add_ing(uid, 'farm', t)
    elif cat == 'farming' and sub == 'herbgarden':
        add_ing(uid, 'herb', t)
    elif cat == 'crafting' and sub == 'fish':
        add_ing(uid, 'fish', t)
    elif cat == 'artefacts' and sub == 'fragments' and re.match(r'^T\d_(RUNE|SOUL|RELIC)$', uid):
        add_ing(uid, 'fragment', t)

for it in as_list(dump['farmableitem']):
    uid = it['@uniquename']
    if uid.endswith('_GROWN'):
        add_ing(uid, 'animal', tier_of(it))

# fish products (chopped fish, fish sauce) used in food recipes
for it in as_list(dump['consumableitem']):
    uid = it['@uniquename']; cat = it.get('@shopcategory'); sub = it.get('@shopsubcategory1')
    if cat == 'crafting' and sub == 'fish':
        add_ing(uid, 'fish', tier_of(it))

# ---------------- helpers for recipes ----------------
def parse_res(r):
    uid = r['@uniquename']; cnt = int(float(r['@count']))
    noret = r.get('@maxreturnamount') == '0'
    return [uid, cnt] + ([1] if noret else [])

def pick_recipe(craftreq):
    """From craftingrequirements (dict or list) pick the standard craft/refine
    recipe; skip transmutes. Returns (resources, batch) or None."""
    for req in as_list(craftreq):
        if not isinstance(req, dict): continue
        over = req.get('@craftbuttonlocaoverride', '')
        if 'TRANSMUTE' in over: continue
        res = as_list(req.get('craftresource'))
        if not res: continue
        resources = [parse_res(r) for r in res]
        batch = int(float(req.get('@amountcrafted', '1') or '1'))
        return resources, batch
    return None

def enchant_entries(it):
    out = {}
    for e in as_list((it.get('enchantments') or {}).get('enchantment')):
        lvl = int(e['@enchantmentlevel'])
        rec = pick_recipe(e.get('craftingrequirements'))
        upg = None
        ur = (e.get('upgraderequirements') or {}).get('upgraderesource')
        if ur:
            urs = as_list(ur)
            upg = [[u['@uniquename'], int(float(u['@count']))] for u in urs]
        out[lvl] = {'recipe': rec, 'upgrade': upg}
    return out

# ---------------- collect candidate output items ----------------
items = OrderedDict()   # uid -> record
skipped = []

def add_item(uid, tier, cat, sub, it, refines_from=None):
    if EXCLUDE_RE.search(uid):
        return
    if tier is None or tier < 2 or tier > 8:
        return
    rec = pick_recipe(it.get('craftingrequirements'))
    if not rec:
        return
    ench = enchant_entries(it)
    recipes = {0: rec}
    upgrades = {}
    for lvl, e in ench.items():
        if e['recipe']: recipes[lvl] = e['recipe']
        if e['upgrade']: upgrades[lvl] = e['upgrade']
    items[uid] = {
        'name': base_name(uid), 'tier': tier, 'cat': cat, 'sub': sub,
        'recipes': recipes, 'upgrades': upgrades,
    }

# --- weapons + tools (weapon + transformationweapon sections)
for it in as_list(dump['weapon']) + as_list(dump['transformationweapon']):
    uid = it['@uniquename']; cat = it.get('@shopcategory'); sub = it.get('@shopsubcategory1')
    t = tier_of(it)
    if cat == 'weapons':
        if sub in MELEE: add_item(uid, t, 'melee', sub, it)
        elif sub in RANGED: add_item(uid, t, 'ranged', sub, it)
        elif sub in MAGIC: add_item(uid, t, 'magic', sub, it)
    elif cat == 'gathering' and '_TOOL_' in uid:
        add_item(uid, t, 'tools', sub, it)

# --- equipment: armor, offhands, bags, capes, gatherer gear, fishing rod tool
for it in as_list(dump['equipmentitem']):
    uid = it['@uniquename']; cat = it.get('@shopcategory'); sub = it.get('@shopsubcategory1')
    t = tier_of(it)
    if cat in ('head','armors','shoes'):
        add_item(uid, t, 'armor', sub, it)
    elif cat == 'offhands':
        add_item(uid, t, 'offhand', sub, it)
    elif cat == 'bags':
        add_item(uid, t, 'bags_capes', 'bag', it)
    elif cat == 'capes':
        add_item(uid, t, 'bags_capes', 'cape', it)
    elif cat == 'gathering':
        add_item(uid, t, 'armor', 'gatherer_' + (sub or ''), it)

# --- mounts
for it in as_list(dump['mount']):
    uid = it['@uniquename']; sub = it.get('@shopsubcategory1'); t = tier_of(it)
    if sub in ('basemounts','raremounts'):
        add_item(uid, t, 'mounts', sub, it)

# --- food & potions
for it in as_list(dump['consumableitem']):
    uid = it['@uniquename']; cat = it.get('@shopcategory'); sub = it.get('@shopsubcategory1')
    t = tier_of(it)
    if cat == 'consumables' and sub == 'food':
        add_item(uid, t, 'food', 'food', it)
    elif cat == 'consumables' and sub == 'potions':
        add_item(uid, t, 'potions', 'potion', it)

# --- refined materials (outputs) + map raw -> refined
refined_family = {'PLANKS':'wood','CLOTH':'fiber','LEATHER':'hide','STONEBLOCK':'stone','METALBAR':'ore'}
raw_family = {'WOOD':'wood','FIBER':'fiber','HIDE':'hide','ROCK':'stone','ORE':'ore'}
refines_to = {}
for it in as_list(dump['simpleitem']):
    uid = it['@uniquename']; cat = it.get('@shopcategory'); sub = it.get('@shopsubcategory1')
    t = tier_of(it)
    if cat == 'crafting' and sub == 'refinedresources':
        m = re.match(r'^T\d_([A-Z]+)(_LEVEL\d)?$', uid)
        fam = refined_family.get(m.group(1)) if m else None
        if fam:
            add_item(uid, t, 'refined', fam, it)
            if uid in items:
                # map its raw ingredient -> this refined output
                for r in items[uid]['recipes'][0][0]:
                    base = re.match(r'^T\d_([A-Z]+)', r[0])
                    if base and base.group(1) in raw_family:
                        refines_to[r[0]] = uid

# ---------------- artifact/ingredient filtering (fixpoint) ----------------
def all_ingredient_ids(rec):
    ids = set()
    for lvl, (res, batch) in rec['recipes'].items():
        for r in res: ids.add(r[0])
    for lvl, ups in rec['upgrades'].items():
        for u in ups: ids.add(u[0])
    return ids

unresolved_report = {}
changed = True
while changed:
    changed = False
    for uid in list(items.keys()):
        bad = [i for i in all_ingredient_ids(items[uid])
               if i not in ingredients and i not in items]
        if bad:
            unresolved_report[uid] = bad
            del items[uid]
            changed = True

# ---------------- market id + enchant caps ----------------
def market_id(uid, lvl=0):
    """AODP item id for a dump uniquename at enchant level lvl."""
    if lvl == 0:
        return uid
    if '_LEVEL' in uid:
        return uid + '@' + uid.rsplit('_LEVEL', 1)[1][0]
    return uid + '@' + str(lvl)

# enchant level encoded in the uniquename itself (resources)
def own_level(uid):
    m = re.search(r'_LEVEL(\d)$', uid)
    return int(m.group(1)) if m else None

fmt_ids = set(NAMES.keys())

def valid_market(uid, lvl):
    if lvl == 0: return uid in fmt_ids
    return (uid + '@' + str(lvl)) in fmt_ids

# ---------------- emit ----------------
out_items = OrderedDict()
for uid, rec in items.items():
    lvl_self = own_level(uid)
    ench_levels = sorted(rec['recipes'].keys())
    # verify each enchant level actually exists as a market item
    ench_levels = [l for l in ench_levels if l == 0 or valid_market(uid, l)]
    r = {
        'n': rec['name'], 't': rec['tier'], 'c': rec['cat'], 's': rec['sub'],
        'rx': {str(l): {'in': rec['recipes'][l][0], 'b': rec['recipes'][l][1]}
               for l in ench_levels},
    }
    ups = {str(l): rec['upgrades'][l] for l in sorted(rec['upgrades'].keys())
           if l == 0 or valid_market(uid, l)}
    if ups: r['up'] = ups
    if lvl_self is not None: r['el'] = lvl_self   # own enchant level (resources)
    if uid in refines_to.values():
        pass
    out_items[uid] = r

# raw materials as catalog entries (for the Raw Materials filter + My Materials)
out_raw = OrderedDict()
for raw_uid, ref_uid in sorted(refines_to.items()):
    if ref_uid in out_items and raw_uid in ingredients:
        i = ingredients[raw_uid]
        out_raw[raw_uid] = {'n': i['name'], 't': i['tier'],
                            'el': own_level(raw_uid) or 0, 'to': ref_uid}

out_ing = OrderedDict()
for uid, i in sorted(ingredients.items()):
    out_ing[uid] = {'n': i['name'], 'k': i['kind'], 't': i['tier']}

catalog = {
    'generated': datetime.date.today().isoformat(),
    'source': 'github.com/ao-data/ao-bin-dumps',
    'items': out_items,
    'raw': out_raw,
    'ingredients': out_ing,
}

with open(OUT, 'w') as f:
    f.write('// Craft Ledger item catalog — generated from ao-bin-dumps (items.json)\n')
    f.write('// Regenerate with tools/gen_catalog.py. Do not edit by hand.\n')
    f.write('window.CRAFT_LEDGER_DATA = ')
    json.dump(catalog, f, separators=(',', ':'))
    f.write(';\n')

# ---------------- report ----------------
from collections import Counter
c = Counter(v['c'] for v in out_items.values())
print('outputs:', len(out_items), dict(c))
print('raw entries:', len(out_raw))
print('ingredients:', len(out_ing))
import os
print('size:', os.path.getsize(OUT), 'bytes')
# show a sample of exclusions for sanity
ex_sample = {k: v for k, v in list(unresolved_report.items())[:15]}
print('excluded (sample):')
for k, v in ex_sample.items():
    print('  ', k, '->', v[:3])
print('total excluded:', len(unresolved_report))

#!/usr/bin/env python3
"""Download the CC0 Poly Haven textures and scanned models used by Gulmira.

Textures land in assets/textures/<id>/{diff,nor,arm}.jpg, models in
assets/models/ph/<id>/<id>.gltf (+ .bin + textures/). Re-running skips files
that are already present. Everything here is CC0 (polyhaven.com/license).
"""
import json, os, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
UA = {'User-Agent': 'Gulmira-assets/1.0 (hobby game; github.com/JerzySukiennik)'}

TEX_2K = ['tiger_rock', 'rocky_terrain_02', 'gravelly_sand', 'dry_ground_rocks', 'cliff_side',
          'clay_plaster', 'rough_plaster_brick_04']
TEX_1K = ['aerial_rocks_02', 'sandy_gravel_02', 'rock_face', 'dirt_aerial_02', 'stony_dirt_path',
          'mud_cracked_dry_03', 'dry_ground_01', 'rocky_trail_02', 'rough_plaster_broken',
          'worn_cracked_plaster', 'excavated_soil_wall', 'damaged_plaster', 'white_rough_plaster',
          'yellow_plaster_02', 'weathered_planks', 'wood_shutter', 'wooden_gate',
          'rusty_corrugated_iron', 'corrugated_iron', 'rusty_metal_02', 'rust_coarse_01',
          'rusty_painted_metal', 'concrete_wall_006', 'sandstone_brick_wall_01', 'burned_ground_01',
          'medieval_wall_01']
MODELS = ['namaqualand_boulder_02', 'namaqualand_boulder_03', 'namaqualand_boulder_04',
          'namaqualand_boulder_05', 'namaqualand_boulder_06', 'namaqualand_boulders_01',
          'namaqualand_rocks_01', 'namaqualand_stones_01', 'namaqualand_cliff_01',
          'namaqualand_cliff_02', 'boulder_01', 'rock_07', 'rock_09', 'rock_face_01', 'rock_face_02',
          'mountainside', 'wild_rooibos_bush', 'searsia_lucida', 'searsia_burchellii',
          'dead_quiver_branch_01', 'dry_branches_medium_01', 'dead_tree_trunk',
          'Barrel_01', 'Barrel_02', 'barrel_03', 'metal_jerrycan', 'metal_jerrycan_green',
          'plastic_jerrycan', 'wooden_crate_01', 'wooden_crate_02', 'wooden_military_crate',
          'old_military_crate', 'ammo_box', 'old_tyre', 'rusted_wheel_rim_01',
          'concrete_road_barrier', 'propane_tank', 'cement_bag', 'portable_generator',
          'wooden_bucket_01', 'ceramic_pot', 'brass_pot_01', 'folding_wooden_stool',
          'WoodenTable_01', 'WoodenChair_01', 'covered_car', 'trashbag', 'cardboard_box_01',
          'modular_electricity_poles', 'wooden_barrels_01', 'planter_pot_clay', 'wooden_ladder',
          'Lantern_01']

MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'arm': 'arm'}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest + '.part', 'wb') as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    os.replace(dest + '.part', dest)
    return True


def texture(asset, res):
    files = get_json(f'https://api.polyhaven.com/files/{asset}')
    for key, short in MAPS.items():
        entry = files.get(key, {}).get(res, {}).get('jpg')
        if not entry:
            print(f'  ! {asset} has no {key} {res}')
            continue
        dest = os.path.join(ROOT, 'assets', 'textures', asset, f'{short}.jpg')
        if download(entry['url'], dest):
            print(f'  + {asset}/{short}.jpg')


def model(asset, res='1k'):
    files = get_json(f'https://api.polyhaven.com/files/{asset}')
    g = files.get('gltf', {}).get(res, {}).get('gltf')
    if not g:
        print(f'  ! {asset} has no gltf {res}')
        return
    base = os.path.join(ROOT, 'assets', 'models', 'ph', asset)
    download(g['url'], os.path.join(base, f'{asset}.gltf'))
    for rel, inc in g.get('include', {}).items():
        download(inc['url'], os.path.join(base, rel))
    print(f'  + model {asset}')


def main():
    only = set(sys.argv[1:])
    for a in TEX_2K:
        if not only or a in only:
            texture(a, '2k'); time.sleep(0.3)
    for a in TEX_1K:
        if not only or a in only:
            texture(a, '1k'); time.sleep(0.3)
    for a in MODELS:
        if not only or a in only:
            try:
                model(a)
            except Exception as e:
                print(f'  ! {a}: {e}')
            time.sleep(0.3)


if __name__ == '__main__':
    main()

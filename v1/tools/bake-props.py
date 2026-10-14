"""Decimate Poly Haven scans into game LODs and export GLB.

/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/bake-props.py
Output: assets/models/game/<name>_lod<k>.glb
"""
import bpy, os, sys, math

ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath or __file__), '..'))
if not os.path.isdir(os.path.join(ROOT, 'assets')):
    ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SRC = os.path.join(ROOT, 'assets', 'models', 'ph')
OUT = os.path.join(ROOT, 'assets', 'models', 'game')
os.makedirs(OUT, exist_ok=True)

# name: [tri targets per LOD]
JOBS = {
    'namaqualand_boulder_02': [7000, 1400, 300],
    'namaqualand_boulder_03': [7000, 1400, 300],
    'namaqualand_boulder_04': [7000, 1400, 300],
    'namaqualand_boulder_05': [7000, 1400, 300],
    'namaqualand_boulder_06': [7000, 1400, 300],
    'namaqualand_boulders_01': [9000, 1800, 400],
    'namaqualand_rocks_01': [6000, 1200],
    'namaqualand_stones_01': [5000, 1000],
    'namaqualand_cliff_01': [12000, 2500, 600],
    'namaqualand_cliff_02': [14000, 3000, 700],
    'boulder_01': [6000, 1200, 300],
    'rock_07': [4000, 900],
    'rock_09': [4000, 900],
    'rock_face_01': [6000, 1200],
    'rock_face_02': [6000, 1200],
    'dead_tree_trunk': [8000, 1500],
    'wild_rooibos_bush': [6000, 1500],
    'dead_quiver_branch_01': [5000, 1200],
    'dry_branches_medium_01': [5000, 1200],
    'concrete_road_barrier': [2500],
    'WoodenChair_01': [3000],
    'metal_jerrycan': [3000],
    'cardboard_box_01': [1500],
    'portable_generator': [6000],
    'wooden_military_crate': [5000],
    'Lantern_01': [3000],
    'old_military_crate': [6000],
    'covered_car': [9000],
    'wooden_barrels_01': [8000],
    'searsia_burchellii': [9000],
}
PASSTHROUGH = ['Barrel_01', 'Barrel_02', 'barrel_03', 'metal_jerrycan_green', 'plastic_jerrycan', 'wooden_crate_01', 'wooden_crate_02',
               'ammo_box', 'old_tyre', 'rusted_wheel_rim_01', 'propane_tank', 'cement_bag', 'wooden_bucket_01', 'ceramic_pot', 'brass_pot_01',
               'folding_wooden_stool', 'WoodenTable_01', 'trashbag', 'planter_pot_clay', 'wooden_ladder']


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def load(name):
    clear()
    path = os.path.join(SRC, name, name + '.gltf')
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def export(name):
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', export_apply=True,
                              export_image_format='JPEG', export_jpeg_quality=88, export_draco_mesh_compression_enable=False)


def run():
    only = set(a for a in sys.argv[sys.argv.index('--') + 1:]) if '--' in sys.argv else set()
    for name, targets in JOBS.items():
        if only and name not in only:
            continue
        for k, target in enumerate(targets):
            objs = load(name)
            total = tri_count(objs)
            ratio = min(1.0, target / max(1, total))
            for o in objs:
                if ratio < 0.999:
                    m = o.modifiers.new('dec', 'DECIMATE')
                    m.ratio = ratio
                    m.use_collapse_triangulate = True
            if k > 0:
                for img in bpy.data.images:
                    if img.size[0] > 64:
                        img.scale(max(64, img.size[0] >> (k + 0)), max(64, img.size[1] >> (k + 0)))
            export(f'{name}_lod{k}')
            print(f'[bake] {name} lod{k}: {total} -> ~{int(total * ratio)}', flush=True)
    for name in PASSTHROUGH:
        if only and name not in only:
            continue
        objs = load(name)
        export(f'{name}_lod0')
        print(f'[bake] {name} passthrough {tri_count(objs)}', flush=True)


run()

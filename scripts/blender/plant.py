# Aquarium decor, rebuilt as real 3D geometry and rendered orthographically
# to 2D sprites - the Blender half of the "procedural, but lit for real"
# pipeline. Supersedes the single-species `plant-sword.py` prototype.
#
# WHY THIS EXISTS. `scene/gen/*.ts` draws these same species as flat Skia
# ribbons, and it plateaus for five reasons that are all consequences of
# there being no actual surface to light:
#
#   1. A leaf is painted as ONE gradient across its width, so it reads as a
#      cylinder. A real strap leaf FOLDS along its midrib - two halves at
#      different angles to the light, with a value break at the fold.
#   2. Only a midrib line; no lateral venation.
#   3. `widthAt` is a pure sine, so every silhouette is a perfect symmetric
#      lens. Real blades have an undulate margin and their widest point sits
#      forward of centre.
#   4. No transmission - underwater leaves are thin and lit from above, so
#      most of their life comes from light passing THROUGH them, not
#      bouncing off.
#   5. `depth` only darkens an element that turns away; it never narrows it,
#      so a rosette stays a paper fan.
#
# Every one of those is free here: fold and twist are geometry, venation is
# a UV-space texture, the margin is noise on the profile, transmission is a
# Translucent BSDF, and foreshortening is just what a camera does.
#
# It also answers the one hard limit `themes/nature-scape-sprites.ts`
# documents about the painted PNGs - that they break past ~1.7x scale
# because no source art exists above their shipped pixel size. These have no
# such ceiling: re-run at any --res.
#
# THREE PASSES per piece, from one scene:
#   beauty  - albedo x real lighting, transparent film
#   normal  - `fish/normal-map.ts`'s exact encoding, so a piece can feed the
#             same relight path the fish already use
#   depth   - linear 0..1 across the piece's own front-to-back extent
#
# Run one piece:
#   blender --background --factory-startup --python plant.py -- \
#           --species sword --out out/sword.png --seed 3
# Every species x seed (see plant-batch.py for the driver):
#   blender --background --factory-startup --python plant.py -- --list

import argparse
import json
import math
import random
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

# Screen-space light vector, from DEFAULT_SCENE_DESIGN.lighting. +y is DOWN
# in the art tree, so this is a light from the upper left.
LIGHT_DIR_2D = (-0.45, -0.89)


def hexlin(h):
    """sRGB hex -> linear RGB.

    Worth having rather than hand-converting: the prototype carried
    hand-computed constants for `#458517` that were wrong in every channel
    (0.104, 0.219, 0.036 against a true 0.060, 0.235, 0.007), which pulled
    every leaf toward blue-grey. Reading the same hex strings
    `scene-design.ts` holds removes a whole class of that.
    """
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# How far each species pulls from its `scene-design.ts` colour toward the
# MEASURED mean of the painted PNG it is modelled on.
#
# Binding the albedo to scene-design.ts alone was a mistake that the
# preview's A/B/C strip caught: those constants describe the Skia
# generator, which is itself darker and bluer than the painted art. Sampling
# the PNGs put numbers on it - painted pieces sit at mean luminance ~0.63-0.67
# with blue well BELOW red (#88b853), against 0.474 and blue ABOVE red
# (#558662) for the first renders.
#
# The painted value is a LIT pixel, not an albedo, so pulling all the way to
# it would double-count the lighting. This fraction is tuned by re-measuring
# the render, not guessed - see scripts/blender/README.md.
PAINTED_PULL = 0.55


def albedo(design_hex, painted_hex, pull=PAINTED_PULL, scale=1.0):
    a, b = hexlin(design_hex), hexlin(painted_hex)
    return tuple(x + (y - x) * (pull * scale) for x, y in zip(a, b))


def lighten(rgb, amount):
    """Match `@/shared/lib/color`'s `lighten` closely enough for art intent -
    a move toward white by `amount`, done in linear space."""
    return tuple(c + (1.0 - c) * amount for c in rgb)


# --------------------------------------------------------------- species
#
# Colours and counts mirror DEFAULT_SCENE_DESIGN.species.* in
# `src/shared/aquarium/scene/scene-design.ts`, so a 3D piece and its Skia
# counterpart are the same plant rather than two plants that merely look
# similar. Lengths are in the same local units the .ts generators use,
# divided by 100 to keep Blender near metre scale.
#
# `form` picks the arrangement; `blade` picks the leaf silhouette.

SPECIES = {
    # A bold mid-ground rosette of long arching lance leaves.
    "sword": dict(
        form="rosette",
        pull=0.70,  # trimmed by re-measuring the render, not guessed
        painted="#88b853",  # measured mean of the painted PNG this models
        blade="lance",
        dark="#1d5314",
        mid="#458517",
        vein="#12360c",
        tip_lighten=0.24,
        count=(5, 4),
        spread=(7.0, 3.0),
        jitter=10.0,
        length=(55.0, 40.0),
        width_factor=(0.16, 0.06),
        droop=(6.0, 10.0),
        twist=(20.0, 75.0),
        fold=(0.35, 0.6),
        yaw=110.0,
        sway=20,
    ),
    # Same rosette machinery, tuned spikier and shorter - the foreground
    # tuft `grass-spiky.png` is the painted equivalent of.
    "grass": dict(
        form="rosette",
        pull=0.46,  # trimmed by re-measuring the render, not guessed
        painted="#8dba59",  # measured mean of the painted PNG this models
        blade="lance",
        dark="#1d5314",
        mid="#4f8f1d",
        vein="#12360c",
        tip_lighten=0.3,
        count=(7, 5),
        spread=(9.0, 4.0),
        jitter=16.0,
        length=(38.0, 26.0),
        width_factor=(0.075, 0.03),
        droop=(3.0, 7.0),
        twist=(10.0, 45.0),
        fold=(0.45, 0.7),
        yaw=130.0,
        sway=60,
    ),
    # Tall background fronds: ~20:1 aspect, heavy lean and curve. The .ts
    # note is explicit that too FEW of these read as flat dark planks, so the
    # count stays high here too.
    "kelp": dict(
        form="rosette",
        pull=0.42,  # trimmed by re-measuring the render, not guessed
        painted="#80b97e",  # measured mean of the painted PNG this models
        blade="strap",
        dark="#226332",
        mid="#377f30",
        vein="#1a4d26",
        tip_lighten=0.3,
        count=(5, 3),
        # Narrow. The camera auto-frames each piece, so absolute length does
        # not change how big a frond reads - SPLAY does. At 11 deg per index
        # the outer fronds leant past 50 deg, the bounding box went wide and
        # short, and the auto-frame shrank a 6m kelp into a squat tuft.
        spread=(4.0, 3.0),
        jitter=22.0,
        # `heightMin: 430, heightRange: 180` - kelp is the tallest thing in
        # the scene by a wide margin. A first pass at 160 made it a squat
        # tuft indistinguishable from `grass`.
        length=(430.0, 180.0),
        width_factor=(0.05, 0.02),
        droop=(40.0, 70.0),
        twist=(30.0, 90.0),
        fold=(0.3, 0.5),
        yaw=120.0,
        sway=150,
    ),
    # An epiphyte: a short horizontal rhizome with petioles rising off it,
    # each ending in a broad spade blade. The only form here that is NOT a
    # rosette from a single crown.
    "anubias": dict(
        form="rhizome",
        pull=0.4,  # trimmed by re-measuring the render, not guessed
        painted="#8fba71",  # measured mean of the painted PNG this models
        blade="spade",
        dark="#1e6434",
        mid="#3e8433",
        vein="#144023",
        tip_lighten=0.24,
        count=(3, 3),
        spread=(18.0, 8.0),
        jitter=10.0,
        stem=(10.0, 6.0),
        length=(30.0, 22.0),
        width_factor=(0.5, 0.16),
        droop=(2.0, 6.0),
        twist=(8.0, 30.0),
        fold=(0.25, 0.45),
        yaw=95.0,
        rhizome_span=6.0,
        stem_width=1.4,
        sway=14,
    ),
    # Whorls of fine needles up a stalk - a filament plant, not a blade
    # plant, so it gets its own form.
    "cabomba": dict(
        form="whorl",
        pull=0.2,  # trimmed by re-measuring the render, not guessed
        painted="#7eb360",  # measured mean of the painted PNG this models
        stalk="#26601e",
        leaflet1="#2d691c",
        leaflet2="#4f921e",
        leaflet3="#1e5715",
        count=(3, 3),
        height=(170.0, 140.0),
        lean=(4.0, 6.0),
        curve=22.0,
        spacing=6.0,
        stalk_width=(1.6, 0.6),
        leaflet=(14.0, 9.0),
        needles=(5, 4),
        whorl_arc=74.0,
        sway=110,
    ),
}

SPECIES.update(
    {
        # HARDSCAPE. A tank cannot be dressed from plants alone - the painted
        # theme leans on driftwood and boulders for most of its visual mass,
        # and a scene built only from the five plant species above reads as a
        # lawn.
        #
        # The `painted` references here are the measured means of the real
        # PNGs, and two of them are surprising until you look: `rock-a.png`
        # measures GREEN (#9bad61), not grey, because every rock in that art
        # is moss-capped. Matching the stone alone would have produced a
        # correctly-lit object that looked nothing like the scene it joins.
        "rock": dict(
            form="rock",
            painted="#9bad61",
            # Low. `painted` is the mean of a MOSS-COVERED rock, so pulling stone
            # hard toward it turns grey stone into cream. The moss tufts carry
            # the green; the stone underneath must stay stone.
            pull=0.16,
            stone="#3f453b",
            moss="#3d6b16",
            radius=(58.0, 34.0),
            squash=(0.62, 0.22),
            moss_count=520,
            sway=0,
        ),
        "rocksmall": dict(
            form="rock",
            painted="#96a95d",
            pull=0.09,
            stone="#474a40",
            moss="#3d6b16",
            radius=(30.0, 16.0),
            squash=(0.58, 0.2),
            moss_count=240,
            sway=0,
        ),
        "driftwood": dict(
            form="driftwood",
            painted="#91a455",
            pull=0.12,
            bark="#3b2a17",
            length=(150.0, 90.0),
            # Thick. At radius 9 the first render was a stick figure, not the
            # tangled root ball the painted art leans on for visual mass.
            radius=(20.0, 9.0),
            branches=(3, 3),
            sway=0,
        ),
        "mossball": dict(
            form="mossball",
            painted="#84b24d",
            pull=0.30,
            dark="#274f10",
            tints=("#476d0b", "#235705", "#6f9607"),
            radius=(46.0, 18.0),
            tuft_count=420,
            sway=0,
        ),
        # A low broad clump - `leafy-bush.png`'s equivalent. Reuses the
        # rosette machinery with short, wide, spade blades and a high count.
        "bush": dict(
            form="rosette",
            blade="spade",
            painted="#75aa4c",
            pull=0.52,
            dark="#1d4a12",
            mid="#3f7a1a",
            vein="#12360c",
            tip_lighten=0.3,
            count=(18, 10),
            spread=(7.0, 5.0),
            jitter=34.0,
            length=(15.0, 11.0),
            width_factor=(0.5, 0.16),
            droop=(6.0, 12.0),
            twist=(15.0, 60.0),
            fold=(0.3, 0.5),
            yaw=170.0,
            sway=20,
        ),
    }
)

U = 100.0  # local art units per Blender metre


# ---------------------------------------------------------------- geometry


def blade_profile(t, width, phase, kind):
    """Half-width across a blade at 0..1 along its length.

    Not `sin(t*pi)`: each silhouette gets its widest point somewhere other
    than the middle and an asymmetric fall-off to the tip, plus a
    low-frequency ripple on the margin - the undulate edge a clean sine has
    no way to express (defect 3).
    """
    if t <= 0.0 or t >= 1.0:
        return 0.0
    peak, fall = {
        "lance": (0.36, 0.75),  # widest low, drawn-out point
        "strap": (0.30, 1.35),  # near-parallel sides, blunt end
        "spade": (0.46, 0.55),  # broad, rounded
    }[kind]
    if t < peak:
        base = math.sin((t / peak) * math.pi * 0.5)
    else:
        base = math.cos(((t - peak) / (1.0 - peak)) * math.pi * 0.5) ** fall
    ripple = 1.0 + 0.11 * math.sin(t * 9.0 + phase) + 0.05 * math.sin(t * 21.0 + phase * 2.3)
    return 0.5 * width * base * ripple


def blade_mesh(name, length, width, droop, twist_max, fold, phase, kind):
    """One leaf as a folded, twisted ribbon surface.

    The fold is the important part (defect 1): cross-sections are a shallow
    V about the midrib, so the two halves of the blade meet the light at
    genuinely different angles and the shader has something real to shade.
    """
    ns, nw = 34, 11
    verts, uvs = [], []
    world_up = Vector((0.0, 0.0, 1.0))

    for i in range(ns):
        v = i / (ns - 1)
        arc = v * v
        px = droop * arc * 1.15
        pz = length * (v - 0.16 * arc * arc)
        dv = 1e-3
        arc2 = (v + dv) ** 2
        tangent = Vector(
            (droop * arc2 * 1.15 - px, 0.0, length * ((v + dv) - 0.16 * arc2 * arc2) - pz)
        )
        tangent.normalize()

        # Twist about the leaf's own axis is what makes some of a rosette
        # present edge-on and some flat-on with no per-leaf special-casing,
        # and it is what replaces `depth`'s darken-only hack (defect 5).
        side0 = world_up.cross(tangent)
        if side0.length < 1e-6:
            side0 = Vector((1.0, 0.0, 0.0))
        side0.normalize()
        up0 = tangent.cross(side0).normalized()
        rot = Matrix.Rotation(twist_max * (v**1.4), 4, tangent)
        side, up = rot @ side0, rot @ up0

        half = blade_profile(v, width, phase, kind)
        for j in range(nw):
            u = j / (nw - 1)
            across = (u - 0.5) * 2.0
            lift = fold * half * (1.0 - abs(across)) ** 1.5
            verts.append(Vector((px, 0.0, pz)) + side * (across * half) + up * lift)
            uvs.append((u, v))

    faces = []
    for i in range(ns - 1):
        for j in range(nw - 1):
            a = i * nw + j
            faces.append((a, a + 1, a + nw + 1, a + nw))
    return _mesh(name, verts, faces, uvs)


def needle_mesh(name, length, width, bend, phase):
    """A cabomba leaflet: a very thin tapered strip, slightly bowed.

    Flat rather than folded - at this width a fold would be sub-pixel, and
    what actually sells a filament plant is the sheer count of them
    overlapping at different angles.
    """
    ns = 8
    verts, uvs = [], []
    for i in range(ns):
        v = i / (ns - 1)
        px = bend * v * v
        pz = length * v
        half = 0.5 * width * (1.0 - v) ** 0.6
        for j, u in ((0, 0.0), (1, 1.0)):
            verts.append(Vector((px, 0.0, pz)) + Vector((0.0, (u - 0.5) * 2.0 * half, 0.0)))
            uvs.append((u, v))
    faces = [(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2) for i in range(ns - 1)]
    return _mesh(name, verts, faces, uvs)


def tube_mesh(name, points, radius, sides=6):
    """A stem/petiole/rhizome - a low-poly swept tube through `points`."""
    verts, uvs, faces = [], [], []
    n = len(points)
    for i, p in enumerate(points):
        fwd = (points[min(i + 1, n - 1)] - points[max(i - 1, 0)]).normalized()
        if fwd.length < 1e-6:
            fwd = Vector((0.0, 0.0, 1.0))
        a = Vector((0.0, 0.0, 1.0)).cross(fwd)
        if a.length < 1e-6:
            a = Vector((1.0, 0.0, 0.0))
        a.normalize()
        b = fwd.cross(a).normalized()
        for j in range(sides):
            ang = 2.0 * math.pi * j / sides
            verts.append(p + (a * math.cos(ang) + b * math.sin(ang)) * radius)
            uvs.append((j / sides, i / (n - 1)))
    for i in range(n - 1):
        for j in range(sides):
            k = (j + 1) % sides
            faces.append((i * sides + j, i * sides + k, (i + 1) * sides + k, (i + 1) * sides + j))
    return _mesh(name, verts, faces, uvs)


def _mesh(name, verts, faces, uvs, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        poly.use_smooth = smooth
        for li in poly.loop_indices:
            uv_layer.data[li].uv = uvs[mesh.loops[li].vertex_index]
    return mesh


# --------------------------------------------------------------- materials


def leaf_material(dark, mid, tip, vein, vein_freq=17.0):
    """Base colour + midrib + lateral veins in UV space, over a BSDF that
    actually transmits light (defects 2 and 4)."""
    mat = bpy.data.materials.new("Leaf")
    mat.use_nodes = True
    mat.use_backface_culling = False
    nt = mat.node_tree
    nt.nodes.clear()

    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nt.nodes.new("ShaderNodeTexCoord").outputs["UV"], sep.inputs["Vector"])

    # Midrib: a narrow dark band at u = 0.5.
    sub = nt.nodes.new("ShaderNodeMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs["X"], sub.inputs[0])
    absn = nt.nodes.new("ShaderNodeMath")
    absn.operation = "ABSOLUTE"
    nt.links.new(sub.outputs[0], absn.inputs[0])
    mid_ramp = nt.nodes.new("ShaderNodeValToRGB")
    mid_ramp.color_ramp.elements[0].position = 0.0
    mid_ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    mid_ramp.color_ramp.elements[1].position = 0.045
    mid_ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    nt.links.new(absn.outputs[0], mid_ramp.inputs["Fac"])

    # Lateral veins: a wave across the blade, sheared along its length so
    # they fan toward the tip instead of running square across it.
    shear = nt.nodes.new("ShaderNodeMath")
    shear.operation = "MULTIPLY_ADD"
    shear.inputs[1].default_value = 0.55
    nt.links.new(sep.outputs["X"], shear.inputs[0])
    nt.links.new(sep.outputs["Y"], shear.inputs[2])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = vein_freq
    nt.links.new(shear.outputs[0], mul.inputs[0])
    sine = nt.nodes.new("ShaderNodeMath")
    sine.operation = "SINE"
    nt.links.new(mul.outputs[0], sine.inputs[0])
    vein_ramp = nt.nodes.new("ShaderNodeValToRGB")
    vein_ramp.color_ramp.elements[0].position = 0.45
    vein_ramp.color_ramp.elements[0].color = (0.45, 0.45, 0.45, 1)
    vein_ramp.color_ramp.elements[1].position = 0.86
    vein_ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(sine.outputs[0], vein_ramp.inputs["Fac"])

    # Dark crown -> mid blade -> bright tip, as in `leafTipLighten`.
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.52
    ramp.color_ramp.elements[1].color = (*mid, 1)
    ramp.color_ramp.elements.new(1.0).color = (*tip, 1)
    nt.links.new(sep.outputs["Y"], ramp.inputs["Fac"])

    veined = nt.nodes.new("ShaderNodeMixRGB")
    veined.blend_type = "MULTIPLY"
    veined.inputs["Fac"].default_value = 0.7
    nt.links.new(ramp.outputs["Color"], veined.inputs["Color1"])
    nt.links.new(vein_ramp.outputs["Color"], veined.inputs["Color2"])

    ribbed = nt.nodes.new("ShaderNodeMixRGB")
    nt.links.new(mid_ramp.outputs["Color"], ribbed.inputs["Fac"])
    ribbed.inputs["Color1"].default_value = (*vein, 1)
    nt.links.new(veined.outputs["Color"], ribbed.inputs["Color2"])

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.36
    bsdf.inputs["IOR"].default_value = 1.42
    nt.links.new(ribbed.outputs["Color"], bsdf.inputs["Base Color"])

    # The backlight. A thin leaf lit from above glows where light passes
    # through it; this is the single cue no amount of flat gradient work in
    # `scene/gen/*.ts` can fake.
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(ribbed.outputs["Color"], trans.inputs["Color"])
    mixer = nt.nodes.new("ShaderNodeMixShader")
    mixer.inputs["Fac"].default_value = 0.38
    nt.links.new(bsdf.outputs["BSDF"], mixer.inputs[1])
    nt.links.new(trans.outputs["BSDF"], mixer.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mixer.outputs["Shader"], out.inputs["Surface"])
    return mat


def solid_material(name, rgb, roughness=0.5, translucency=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    # Stems read pale not because their albedo is light but because a
    # cylinder catches a specular rim along its whole length. Dropping the
    # specular level is what stops an anubias petiole looking like celery.
    bsdf.inputs["Specular IOR Level"].default_value = 0.12
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if translucency <= 0.0:
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        return mat
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    trans.inputs["Color"].default_value = (*rgb, 1)
    mixer = nt.nodes.new("ShaderNodeMixShader")
    mixer.inputs["Fac"].default_value = translucency
    nt.links.new(bsdf.outputs["BSDF"], mixer.inputs[1])
    nt.links.new(trans.outputs["BSDF"], mixer.inputs[2])
    nt.links.new(mixer.outputs["Shader"], out.inputs["Surface"])
    return mat


# ------------------------------------------------------------------- forms


def _add(mesh, mat, transform=None):
    obj = bpy.data.objects.new(mesh.name, mesh)
    obj.data.materials.append(mat)
    if transform is not None:
        obj.matrix_world = transform
    bpy.context.collection.objects.link(obj)
    return obj


def build_rosette(cfg, rng):
    """Leaves radiating from one crown at the origin - sword, grass, kelp."""
    pull = cfg.get("pull", PAINTED_PULL)
    mid = albedo(cfg["mid"], cfg["painted"], pull)
    # Shadows pull only halfway. Lifting them as far as the lit tone would
    # flatten the value range that makes the midrib fold read at all.
    mat = leaf_material(
        albedo(cfg["dark"], cfg["painted"], pull, 0.5),
        mid,
        lighten(mid, cfg["tip_lighten"]),
        albedo(cfg["vein"], cfg["painted"], pull, 0.35),
    )
    n = cfg["count"][0] + int(rng.random() * cfg["count"][1])
    objs = []
    for i in range(n):
        spread = (i - (n - 1) / 2) * (cfg["spread"][0] + rng.random() * cfg["spread"][1])
        splay = math.radians(spread + (rng.random() - 0.5) * cfg["jitter"])
        yaw = math.radians((rng.random() - 0.5) * cfg["yaw"])
        length = (cfg["length"][0] + rng.random() * cfg["length"][1]) / U
        width = length * (cfg["width_factor"][0] + rng.random() * cfg["width_factor"][1])
        droop = (cfg["droop"][0] + rng.random() * cfg["droop"][1]) / U
        mesh = blade_mesh(
            "leaf%d" % i,
            length,
            width,
            droop,
            math.radians(rng.uniform(*cfg["twist"])) * (1 if rng.random() > 0.5 else -1),
            rng.uniform(*cfg["fold"]),
            rng.uniform(0.0, 6.28),
            cfg["blade"],
        )
        objs.append(_add(mesh, mat, Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(splay, 4, "Y")))
    return objs


def build_rhizome(cfg, rng):
    """Anubias: a horizontal rhizome with petioles rising off it, each
    carrying one broad spade blade. Rooted here rather than mounted - the
    epiphyte case is a placement concern, not a geometry one."""
    pull = cfg.get("pull", PAINTED_PULL)
    mid = albedo(cfg["mid"], cfg["painted"], pull)
    dark = albedo(cfg["dark"], cfg["painted"], pull, 0.5)
    vein = albedo(cfg["vein"], cfg["painted"], pull, 0.35)
    leaf_mat = leaf_material(dark, mid, lighten(mid, cfg["tip_lighten"]), vein, vein_freq=11.0)
    # DARKER than the blade, not lighter. A first pass used lighten(dark) and
    # under the key light the petioles blew out into pale celery stalks that
    # dominated the piece - a petiole is a shaded cylinder tucked under the
    # foliage, and it should never be the brightest thing in frame.
    stem_mat = solid_material("Stem", vein, roughness=0.7)
    span = cfg["rhizome_span"] / U
    objs = []

    rz = tube_mesh(
        "rhizome",
        [Vector((-span, 0.0, 0.012)), Vector((0.0, 0.0, 0.016)), Vector((span, 0.0, 0.012))],
        cfg["stem_width"] / U * 1.6,
    )
    objs.append(_add(rz, stem_mat))

    n = cfg["count"][0] + int(rng.random() * cfg["count"][1])
    for i in range(n):
        base_x = -span + (2.0 * span) * (i / max(1, n - 1)) if n > 1 else 0.0
        spread = (i - (n - 1) / 2) * (cfg["spread"][0] + rng.random() * cfg["spread"][1])
        splay = math.radians(spread + (rng.random() - 0.5) * cfg["jitter"])
        yaw = math.radians((rng.random() - 0.5) * cfg["yaw"])
        stem_len = (cfg["stem"][0] + rng.random() * cfg["stem"][1]) / U
        length = (cfg["length"][0] + rng.random() * cfg["length"][1]) / U
        width = length * (cfg["width_factor"][0] + rng.random() * cfg["width_factor"][1])
        xf = (
            Matrix.Translation(Vector((base_x, 0.0, 0.014)))
            @ Matrix.Rotation(yaw, 4, "Z")
            @ Matrix.Rotation(splay, 4, "Y")
        )
        petiole = tube_mesh(
            "petiole%d" % i,
            [Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, stem_len))],
            cfg["stem_width"] / U,
        )
        objs.append(_add(petiole, stem_mat, xf))
        blade = blade_mesh(
            "anubias%d" % i,
            length,
            width,
            (cfg["droop"][0] + rng.random() * cfg["droop"][1]) / U,
            math.radians(rng.uniform(*cfg["twist"])) * (1 if rng.random() > 0.5 else -1),
            rng.uniform(*cfg["fold"]),
            rng.uniform(0.0, 6.28),
            cfg["blade"],
        )
        objs.append(_add(blade, leaf_mat, xf @ Matrix.Translation(Vector((0.0, 0.0, stem_len)))))
    return objs


def build_whorl(cfg, rng):
    """Cabomba: stalks carrying whorls of fine needles.

    Three leaflet tints rather than one, assigned per needle. A filament
    plant read at tank size is essentially a texture, and a single tint
    collapses it into a flat green smear."""
    stalk_mat = solid_material(
        "Stalk", albedo(cfg["stalk"], cfg["painted"], cfg.get("pull", PAINTED_PULL), 0.5), roughness=0.6
    )
    tints = [
        solid_material(
            "Leaflet%d" % i,
            albedo(cfg[k], cfg["painted"], cfg.get("pull", PAINTED_PULL)),
            roughness=0.45,
            translucency=0.35,
        )
        for i, k in enumerate(("leaflet1", "leaflet2", "leaflet3"))
    ]
    n = cfg["count"][0] + int(rng.random() * cfg["count"][1])
    objs = []
    for s in range(n):
        height = (cfg["height"][0] + rng.random() * cfg["height"][1]) / U
        lean = math.radians(cfg["lean"][0] + (rng.random() - 0.5) * cfg["lean"][1])
        curve = math.radians(rng.uniform(-cfg["curve"], cfg["curve"]))
        base_x = (s - (n - 1) / 2) * cfg["spacing"] / U
        base_y = (rng.random() - 0.5) * 0.06

        pts = []
        steps = 12
        for i in range(steps + 1):
            t = i / steps
            ang = lean + curve * t * t
            pts.append(Vector((base_x + math.sin(ang) * height * t, base_y, math.cos(ang) * height * t)))
        radius = (cfg["stalk_width"][0] + rng.random() * cfg["stalk_width"][1]) / U
        objs.append(_add(tube_mesh("stalk%d" % s, pts, radius, sides=5), stalk_mat))

        whorls = max(3, int(height * U / cfg["spacing"]))
        for w in range(whorls):
            t = 0.12 + 0.88 * (w / max(1, whorls - 1))
            idx = min(steps, int(t * steps))
            base = pts[idx]
            k = cfg["needles"][0] + int(rng.random() * cfg["needles"][1])
            for j in range(k * 2):  # both sides of the stalk
                frac = (j % k) / max(1, k - 1) - 0.5
                arc = math.radians(cfg["whorl_arc"]) * frac
                # Full revolution, not a +-75 deg wedge. A whorl is radial;
                # confining the yaw flattened every whorl into the same plane
                # and the plant read as a bare stalk with spines rather than
                # as foliage.
                yaw = math.radians(rng.random() * 360.0)
                ln = (cfg["leaflet"][0] + rng.random() * cfg["leaflet"][1]) / U * (1.0 - 0.35 * t)
                # 0.26 of length, not 0.1: at tank size a 0.1-ratio needle is
                # sub-pixel and vanishes, taking the whole feathery read with
                # it. Fine filaments have to be drawn thicker than they are.
                mesh = needle_mesh("n%d_%d_%d" % (s, w, j), ln, ln * 0.26, ln * 0.25, 0.0)
                xf = (
                    Matrix.Translation(base)
                    @ Matrix.Rotation(yaw, 4, "Z")
                    @ Matrix.Rotation(arc + (math.pi if j >= k else 0.0), 4, "Y")
                )
                objs.append(_add(mesh, tints[(s + w + j) % 3], xf))
    return objs


def blob_mesh(name, radius, squash, rng, lobes=(0.30, 0.18, 0.11), rings=22, segs=32):
    """A boulder: a sphere whose radius is modulated by summed harmonics and
    then cut off flat at z = 0.

    Harmonics rather than a real noise texture because the result has to be
    reproducible from a plain `random.Random` seed with no Blender texture
    baking involved, and because three bands is genuinely enough at the size
    a rock reads in this scene — one for the overall lopsidedness, one for
    facets, one for surface lumps.

    The flat cut matters: every `SCENE_SPRITES` entry is planted by the
    bottom centre of its PNG, so a rock modelled as a full sphere would sit
    half-buried or hover depending on how the framing rounded.
    """
    ph = [rng.uniform(0.0, 6.283) for _ in range(6)]
    verts, uvs, faces = [], [], []
    for i in range(rings + 1):
        v = i / rings
        theta = v * math.pi
        for j in range(segs):
            u = j / segs
            phi = u * 2.0 * math.pi
            r = radius * (
                1.0
                + lobes[0] * math.sin(phi + ph[0]) * math.sin(theta * 1.3 + ph[1])
                + lobes[1] * math.sin(phi * 3.0 + ph[2]) * math.sin(theta * 2.1 + ph[3])
                + lobes[2] * math.sin(phi * 7.0 + ph[4]) * math.sin(theta * 4.7 + ph[5])
            )
            verts.append(
                Vector(
                    (
                        r * math.sin(theta) * math.cos(phi),
                        r * math.sin(theta) * math.sin(phi) * 0.72,
                        r * math.cos(theta) * squash,
                    )
                )
            )
            uvs.append((u, v))
    for i in range(rings):
        for j in range(segs):
            k = (j + 1) % segs
            faces.append((i * segs + j, i * segs + k, (i + 1) * segs + k, (i + 1) * segs + j))
    # FLAT shaded. Smooth normals turned the first boulders into potatoes -
    # aquarium hardscape is angular seiryu-type stone, and the facet is the
    # whole read.
    mesh = _mesh(name, verts, faces, uvs, smooth=False)
    # Sink it so the widest part sits at the substrate line and everything
    # below is cropped by the camera's bottom edge.
    for vert in mesh.vertices:
        vert.co.z += radius * squash * 0.62
    return mesh


def build_rock(cfg, rng):
    """A boulder plus a moss cap.

    The cap is not decoration: every rock in `assets/images/scene/rock-*.png`
    is moss-covered on its upper surface, which is why those PNGs measure
    GREEN (#9bad61) rather than grey. A bare stone would read as a different
    object entirely.
    """
    stone = solid_material(
        "Stone", albedo(cfg["stone"], cfg["painted"], cfg.get("pull", PAINTED_PULL), 0.7), 0.82
    )
    moss = solid_material(
        "Moss",
        albedo(cfg["moss"], cfg["painted"], cfg.get("pull", PAINTED_PULL)),
        0.9,
        translucency=0.2,
    )
    radius = (cfg["radius"][0] + rng.random() * cfg["radius"][1]) / U
    objs = [
        _add(
            blob_mesh("rock", radius, cfg["squash"][0] + rng.random() * cfg["squash"][1], rng), stone
        )
    ]
    # Moss as short needles scattered over the upper hemisphere — cheaper and
    # more legible than a second displaced shell, and it breaks the
    # silhouette the way real growth does.
    for i in range(cfg["moss_count"]):
        phi = rng.uniform(0.0, 6.283)
        theta = rng.uniform(0.05, 0.95) ** 1.7 * (math.pi * 0.42)
        r = radius * 0.95
        base = Vector(
            (
                r * math.sin(theta) * math.cos(phi),
                r * math.sin(theta) * math.sin(phi) * 0.72,
                r * math.cos(theta) * 0.62 + radius * 0.62 * 0.62,
            )
        )
        ln = radius * (0.10 + rng.random() * 0.13)
        objs.append(
            _add(
                needle_mesh("moss%d" % i, ln, ln * 0.42, ln * 0.3, 0.0),
                moss,
                Matrix.Translation(base)
                @ Matrix.Rotation(rng.uniform(0.0, 6.283), 4, "Z")
                @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "Y"),
            )
        )
    return objs


def build_driftwood(cfg, rng):
    """A low trunk with branches rising off it.

    Modelled on the CLUSTER note in `themes/nature-scape-sprites.ts`: the
    painted driftwood only reads as a centrepiece because a wide low log and
    two rising branches overlap. Building that relationship into one piece
    means the theme does not have to stack three sprites to get it.
    """
    bark = solid_material(
        "Bark", albedo(cfg["bark"], cfg["painted"], cfg.get("pull", PAINTED_PULL), 0.8), 0.88
    )
    length = (cfg["length"][0] + rng.random() * cfg["length"][1]) / U
    radius = (cfg["radius"][0] + rng.random() * cfg["radius"][1]) / U

    trunk = []
    steps = 10
    for i in range(steps + 1):
        t = i / steps
        trunk.append(
            Vector(
                (
                    (t - 0.5) * length,
                    math.sin(t * 2.4 + 1.0) * length * 0.06,
                    radius * 0.9 + math.sin(t * 3.1) * length * 0.05,
                )
            )
        )
    objs = [_add(tube_mesh("trunk", trunk, radius, sides=7), bark)]

    for b in range(cfg["branches"][0] + int(rng.random() * cfg["branches"][1])):
        t = rng.uniform(0.15, 0.85)
        base = trunk[min(steps, int(t * steps))]
        rise = length * (0.35 + rng.random() * 0.55)
        lean = math.radians(rng.uniform(-42.0, 42.0))
        pts = []
        for i in range(7):
            s = i / 6
            pts.append(
                base
                + Vector(
                    (
                        math.sin(lean) * rise * s + math.sin(s * 2.0) * rise * 0.12,
                        (rng.random() - 0.5) * 0.01,
                        math.cos(lean) * rise * s,
                    )
                )
            )
        objs.append(_add(tube_mesh("branch%d" % b, pts, radius * (0.32 + rng.random() * 0.3)), bark))
    return objs


def build_mossball(cfg, rng):
    """A marimo: a dense sphere of short leaflets, no trunk, no crown."""
    body = solid_material(
        "MossCore", albedo(cfg["dark"], cfg["painted"], cfg.get("pull", PAINTED_PULL), 0.6), 0.95
    )
    tints = [
        solid_material(
            "MossTuft%d" % i,
            albedo(c, cfg["painted"], cfg.get("pull", PAINTED_PULL)),
            0.9,
            translucency=0.25,
        )
        for i, c in enumerate(cfg["tints"])
    ]
    radius = (cfg["radius"][0] + rng.random() * cfg["radius"][1]) / U
    objs = [_add(blob_mesh("core", radius * 0.86, 0.86, rng, lobes=(0.10, 0.06, 0.04)), body)]
    for i in range(cfg["tuft_count"]):
        phi = rng.uniform(0.0, 6.283)
        theta = math.acos(1.0 - 2.0 * rng.random() ** 0.85)
        d = Vector(
            (math.sin(theta) * math.cos(phi), math.sin(theta) * math.sin(phi) * 0.72, math.cos(theta))
        )
        base = Vector((d.x * radius * 0.8, d.y * radius * 0.8, d.z * radius * 0.8 * 0.86)) + Vector(
            (0.0, 0.0, radius * 0.86 * 0.86 * 0.62)
        )
        ln = radius * (0.16 + rng.random() * 0.2)
        objs.append(
            _add(
                needle_mesh("tuft%d" % i, ln, ln * 0.5, ln * 0.25, 0.0),
                tints[i % len(tints)],
                Matrix.Translation(base) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4(),
            )
        )
    return objs


FORMS = {
    "rosette": build_rosette,
    "rhizome": build_rhizome,
    "whorl": build_whorl,
    "rock": build_rock,
    "driftwood": build_driftwood,
    "mossball": build_mossball,
}


# ------------------------------------------------------------------ render


def _sun(name, direction, energy, color, softness_deg):
    light = bpy.data.lights.new(name, type="SUN")
    light.energy = energy
    light.angle = math.radians(softness_deg)
    light.color = color
    obj = bpy.data.objects.new(name, light)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.normalized().to_track_quat("-Z", "Y")
    bpy.context.collection.objects.link(obj)


def setup_lighting():
    lx, ly = LIGHT_DIR_2D
    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # Underwater ambient is strongly tinted, and it is what keeps the shaded
    # halves of every leaf from going black.
    # Green-leaning, not teal. An equal green/blue ambient at this strength
    # was dumping enough blue into the shadows to invert the painted art's
    # red-over-blue relationship - the measured tell was B > R in the render
    # against B < R in every painted reference.
    bg.inputs["Color"].default_value = (0.11, 0.17, 0.085, 1.0)
    # 2.0, not 1.1. The A/B/C strip in the preview made the gap obvious: the
    # painted art these are modelled on sits in a bright yellow-green, and
    # the first renders came back forest-dark. Almost all of that gap is in
    # the SHADOWS, not the lit faces, so lifting ambient closes it without
    # blowing the highlights that make the fold read.
    bg.inputs["Strength"].default_value = 1.9
    _sun("Key", Vector((lx, 0.55, ly)), 9.0, (1.0, 0.96, 0.78), 9.0)
    # The Translucent BSDF only pays off when something is lit from behind -
    # without this the transmission term is dead weight and the render is
    # just a darker version of the flat Skia one.
    _sun("Back", Vector((-lx * 0.4, -1.0, ly * 0.8)), 5.0, (0.85, 0.98, 0.70), 25.0)


CAM_Y = -8.0
PAD = 0.06  # fraction of height kept clear below the crown and around the sides


def setup_camera(objs, res_x, res_y):
    """Frames the piece with its crown at bottom-centre.

    That is not cosmetic: every `SCENE_SPRITES` entry is authored with
    `anchorX 0.5, anchorY 1.0`, so the renderer plants a piece by the bottom
    centre of its own PNG. Getting this wrong buries or floats the piece by
    however far the framing is off.
    """
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    top = max(p.z for p in pts)
    half_w = max(abs(min(p.x for p in pts)), abs(max(p.x for p in pts)))
    need_h = top * (1.0 + 2.0 * PAD)
    need_w = half_w * 2.0 * (1.0 + PAD)
    # Blender applies ortho_scale to the LONGER axis of the output.
    if res_y >= res_x:
        scale = max(need_h, need_w * res_y / res_x)
        v_extent = scale
    else:
        scale = max(need_w, need_h * res_x / res_y)
        v_extent = scale * res_y / res_x

    cam = bpy.data.cameras.new("Cam")
    cam.type = "ORTHO"
    cam.ortho_scale = scale
    obj = bpy.data.objects.new("Cam", cam)
    obj.location = (0.0, CAM_Y, v_extent * 0.5 - top * PAD)
    obj.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    near = min(p.y for p in pts) - CAM_Y
    far = max(p.y for p in pts) - CAM_Y
    return near, far


# -------------------------------------------------------------- data passes
#
# Rendered as flat EMISSION rather than through Cycles' Normal/Z render
# passes and the compositor: an emission shader is exactly the value we want
# with no pass-encoding conventions to reverse-engineer, and it needs ~4
# samples and no denoiser (a denoiser SMEARS a data pass, which is the one
# thing it must never do).


def normal_material():
    """Camera-space normal in `fish/normal-map.ts`'s encoding.

    That module writes `R = nx*0.5+0.5`, `G = ny*0.5+0.5`, `B = mask`,
    `A = 255`, and `core/sksl/warp.ts` recovers `nz = sqrt(1-nx^2-ny^2)`.
    Matching it exactly is what lets a decor piece feed the relight path the
    fish already use instead of needing its own.

    Two conversions matter. Blender's camera space is Y-UP; the art tree is
    Y-DOWN, so G is negated. And a leaf is a single-sided surface, so the
    half of a rosette facing away carries a normal pointing away from the
    camera - useless for relighting a sprite. `Backfacing` flips those,
    legitimate here precisely because the piece is only seen from this one
    camera.
    """
    mat = bpy.data.materials.new("NormalPass")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    xf = nt.nodes.new("ShaderNodeVectorTransform")
    xf.vector_type, xf.convert_from, xf.convert_to = "NORMAL", "WORLD", "CAMERA"
    nt.links.new(geo.outputs["Normal"], xf.inputs["Vector"])

    sign = nt.nodes.new("ShaderNodeMath")  # +1 front face, -1 back face
    sign.operation = "MULTIPLY_ADD"
    sign.inputs[1].default_value = -2.0
    sign.inputs[2].default_value = 1.0
    nt.links.new(geo.outputs["Backfacing"], sign.inputs[0])
    faced = nt.nodes.new("ShaderNodeVectorMath")
    faced.operation = "SCALE"
    nt.links.new(xf.outputs["Vector"], faced.inputs[0])
    nt.links.new(sign.outputs[0], faced.inputs["Scale"])

    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(faced.outputs["Vector"], sep.inputs["Vector"])
    r = nt.nodes.new("ShaderNodeMath")
    r.operation = "MULTIPLY_ADD"
    r.inputs[1].default_value = 0.5
    r.inputs[2].default_value = 0.5
    nt.links.new(sep.outputs["X"], r.inputs[0])
    g = nt.nodes.new("ShaderNodeMath")  # negated: Blender Y-up -> art Y-down
    g.operation = "MULTIPLY_ADD"
    g.inputs[1].default_value = -0.5
    g.inputs[2].default_value = 0.5
    nt.links.new(sep.outputs["Y"], g.inputs[0])

    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(r.outputs[0], comb.inputs["X"])
    nt.links.new(g.outputs[0], comb.inputs["Y"])
    comb.inputs["Z"].default_value = 1.0  # placeholder; alpha becomes the mask
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(comb.outputs["Vector"], emit.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def depth_material(near, far):
    """Linear 0..1 depth across the piece's own extent, 0 nearest the camera.

    Normalised per piece rather than scene-wide so every PNG uses its full
    8 bits regardless of how thin it is front-to-back. NOTE the background
    is also 0, i.e. indistinguishable from "nearest" by value alone -
    consumers must gate on alpha.
    """
    mat = bpy.data.materials.new("DepthPass")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    cam = nt.nodes.new("ShaderNodeCameraData")
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = near
    rng.inputs["From Max"].default_value = max(far, near + 1e-4)
    rng.clamp = True
    nt.links.new(cam.outputs["View Z Depth"], rng.inputs["Value"])
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(rng.outputs["Result"], emit.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def finish_normal(path):
    """Move coverage from A into B, set A opaque, and guarantee the stored
    pair is recoverable.

    The channel shuffle is the last step of `fish/normal-map.ts`'s layout,
    which keeps alpha at 255 everywhere so the shader can read B as the mask
    without fighting premultiplication.

    The clamp is not cosmetic. `warp.ts` recovers the third component as
    `sqrt(1 - nx^2 - ny^2)`, so any pixel whose stored pair is longer than
    unit length yields NaN and a black speck. The Skia-side generator never
    hits that because it builds nx/ny from a height field by construction;
    real 3D geometry does, at every near-edge-on pixel. 0.985 rather than
    0.999 because 8-bit quantisation on save perturbs vector length by up to
    ~0.003, which a first attempt at this clamp duly failed to survive.
    """
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    buf = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(buf)
    buf = buf.reshape(-1, 4)

    mask = buf[:, 3].copy()
    covered = mask > 0.004
    # Uncovered pixels carry the emission of nothing, which decodes to
    # (-1, -1) - the worst value to leave in a texture sampled under decal
    # tiling. Flat-facing is the neutral answer.
    buf[~covered, 0] = 0.5
    buf[~covered, 1] = 0.5

    nx = buf[:, 0] * 2.0 - 1.0
    ny = buf[:, 1] * 2.0 - 1.0
    length = np.sqrt(nx * nx + ny * ny)
    hot = covered & (length > 0.985)
    if hot.any():
        nx[hot] *= 0.985 / length[hot]
        ny[hot] *= 0.985 / length[hot]
    buf[:, 0] = nx * 0.5 + 0.5
    buf[:, 1] = ny * 0.5 + 0.5
    buf[:, 2] = mask
    buf[:, 3] = 1.0

    img.pixels.foreach_set(buf.reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return int(hot.sum()), int(covered.sum())


# -------------------------------------------------------------------- main


def pass_path(out, name):
    stem, _, ext = out.rpartition(".")
    return out if name == "beauty" else "%s-%s.%s" % (stem, name, ext or "png")


def render(scene, args, objs, override, samples, denoise, raw, path):
    saved = None
    if override is not None:
        saved = [list(o.data.materials) for o in objs]
        for o in objs:
            o.data.materials.clear()
            o.data.materials.append(override)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = denoise
    # 'Raw' is not optional for data passes. Under 'Standard' Blender applies
    # the sRGB transfer curve on the way to 8-bit, so an encoded 0.5 would
    # land in the file as ~0.73 and every normal read back would be wrong.
    scene.render.image_settings.color_management = "OVERRIDE" if raw else "FOLLOW_SCENE"
    if raw:
        scene.render.image_settings.view_settings.view_transform = "Raw"
        # The scene-level exposure is an ART control and must not reach a
        # data pass - a normal map brightened by a third of a stop decodes to
        # nonsense. The override carries its own view settings, so pin them.
        scene.render.image_settings.view_settings.exposure = 0.0
        scene.render.image_settings.view_settings.look = "None"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if saved is not None:
        for o, mats in zip(objs, saved):
            o.data.materials.clear()
            for m in mats:
                o.data.materials.append(m)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--species")
    p.add_argument("--out")
    p.add_argument("--seed", type=int, default=3)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--res", default="512x640")
    p.add_argument("--passes", default="beauty,normal,depth")
    p.add_argument("--meta", help="write a JSON sidecar with sprite metadata")
    p.add_argument("--list", action="store_true")
    args = p.parse_args(argv)

    if args.list:
        print(json.dumps({k: {"sway": v["sway"], "form": v["form"]} for k, v in SPECIES.items()}))
        return
    if not args.species or not args.out:
        p.error("--species and --out are required")

    cfg = SPECIES[args.species]
    res_x, res_y = (int(x) for x in args.res.split("x"))
    bpy.ops.wm.read_factory_settings(use_empty=True)

    rng = random.Random("%s-%d" % (args.species, args.seed))
    objs = FORMS[cfg["form"]](cfg, rng)
    setup_lighting()
    near, far = setup_camera(objs, res_x, res_y)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = res_x, res_y
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # Blender 5's default AgX view transform is a film response curve: it
    # desaturates and crushes exactly the saturated greens this art is made
    # of. This is sprite art destined for a Skia canvas, not a photographic
    # frame - the authored colour IS the intended colour.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.2

    wanted = [x.strip() for x in args.passes.split(",") if x.strip()]
    if "beauty" in wanted:
        render(scene, args, objs, None, args.samples, True, False, args.out)
        print("WROTE", args.out)
    if "normal" in wanted:
        path = pass_path(args.out, "normal")
        render(scene, args, objs, normal_material(), 4, False, True, path)
        hot, cov = finish_normal(path)
        print("WROTE %s (clamped %d/%d)" % (path, hot, cov))
    if "depth" in wanted:
        path = pass_path(args.out, "depth")
        render(scene, args, objs, depth_material(near, far), 4, False, True, path)
        print("WROTE", path)

    if args.meta:
        with open(args.meta, "w") as fh:
            json.dump(
                {
                    "species": args.species,
                    "seed": args.seed,
                    "width": res_x,
                    "height": res_y,
                    "anchorX": 0.5,
                    "anchorY": 1.0 - PAD / (1.0 + 2.0 * PAD),
                    "swayHeight": cfg["sway"],
                },
                fh,
                indent=2,
            )


main()

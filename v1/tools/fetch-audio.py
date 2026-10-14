#!/usr/bin/env python3
"""Fetch and bake the Gulmira audio set from real recordings.

Usage:
  python3 tools/fetch-audio.py              # every sound (cached originals are reused)
  python3 tools/fetch-audio.py ak_burst_1   # only the named sounds
  python3 tools/fetch-audio.py --manifest   # rewrite manifest.json and CREDITS.md only

Every entry in SOURCES is CC0 1.0, public domain, CC BY 3.0 or CC BY 4.0. The licence,
author and source page of each file are stored in its mp3 comment tag and in
assets/audio/CREDITS.md, which this script rewrites together with
assets/audio/manifest.json.

Per sound:
  1. Download the original into Niepotrzebne/audio-cache/<name>/<src-id>/orig.<ext>.
     Downloaded files are only read by ffmpeg/ffprobe, never executed or unpacked.
  2. Cut the window [start, start + dur], or for loops take loopD + loopX seconds and
     blend the last loopX seconds into the head (acrossfade) so the wrap is seamless.
  3. One-shots: mono 44.1 kHz, loudnorm to -16 LUFS integrated, true peak <= -1 dBTP,
     libmp3lame 160 kbps. Ambience loops stay stereo. Music: stereo, -18 LUFS, 192 kbps.
  4. Write assets/audio/sfx/<name>.mp3 or assets/audio/music/<name>.mp3.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE = os.path.join(ROOT, 'Niepotrzebne', 'audio-cache')
OUT = os.path.join(ROOT, 'assets', 'audio')
FFMPEG = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg'
FFPROBE = shutil.which('ffprobe') or '/usr/local/bin/ffprobe'
UA = 'Gulmira-audio/1.0 (hobby game; github.com/JerzySukiennik)'

SOURCES = {
    'ak_burst_1': dict(kind='sfx', srcid='fs-201668', url='https://cdn.freesound.org/previews/201/201668_3749344-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Franki-01234/sounds/201668/', author='Franki-01234 (Freesound)', licence='CC0 1.0',
        start=0.15, dur=3.0, loop=None, stereo=False,
        desc='Assault rifle burst fired in a street, short reverberant tail.'),
    'ak_burst_2': dict(kind='sfx', srcid='fs-360607', url='https://cdn.freesound.org/previews/360/360607_4121395-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/mnslugger20/sounds/360607/', author='mnslugger20 (Freesound)', licence='CC0 1.0',
        start=0.0, dur=2.6, loop=None, stereo=False,
        desc='M4 assault rifle long burst.'),
    'ak_burst_3': dict(kind='sfx', srcid='fs-165809', url='https://cdn.freesound.org/previews/165/165809_2872744-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/sidohzen/sounds/165809/', author='sidohzen (Freesound)', licence='CC0 1.0',
        start=0.2, dur=1.45, loop=None, stereo=False,
        desc='Machine gun / rifle burst of about five rounds (source title "machine gun").'),
    'ak_single_1': dict(kind='sfx', srcid='fs-520934', url='https://cdn.freesound.org/previews/520/520934_773642-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/ninebilly/sounds/520934/', author='ninebilly (Freesound)', licence='CC0 1.0',
        start=0.3, dur=0.4, loop=None, stereo=False,
        desc='AK-47 single shot, sharp transient.'),
    'ak_single_2': dict(kind='sfx', srcid='fs-855842', url='https://cdn.freesound.org/previews/855/855842_7157894-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/855842/', author='serøutōnin--deprivəd (Freesound)', licence='CC0 1.0',
        start=0.0, dur=0.8, loop=None, stereo=False,
        desc='AK-47 single shot with the metallic action sound.'),
    'ak_distant_1': dict(kind='sfx', srcid='fs-417690', url='https://cdn.freesound.org/previews/417/417690_7542558-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/SuperPhat/sounds/417690/', author='SuperPhat (Freesound)', licence='CC0 1.0',
        start=0.45, dur=4.4, loop=None, stereo=False,
        desc='Rapid submachine gun fire, distant (source title "Rapid Fire Sub Machine Gun distant").'),
    'ak_distant_2': dict(kind='sfx', srcid='fs-113515', url='https://cdn.freesound.org/previews/113/113515_137116-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/victormalloy/sounds/113515/', author='victormalloy (Freesound)', licence='CC0 1.0',
        start=0.0, dur=4.5, loop=None, stereo=False,
        desc='Distant gunshots (source title "Lewes Gunshots distant").'),
    'hmg_burst_1': dict(kind='sfx', srcid='fs-101961', url='https://cdn.freesound.org/previews/101/101961_1386366-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/CGEffex/sounds/101961/', author='CGEffex (Freesound)', licence='CC BY 4.0',
        start=0.07, dur=2.6, loop=None, stereo=False,
        desc='Heavy machine gun, slow heavy thumps.'),
    'hmg_burst_2': dict(kind='sfx', srcid='fs-165394', url='https://cdn.freesound.org/previews/165/165394_2989529-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/ShawnyBoy/sounds/165394/', author='ShawnyBoy (Freesound)', licence='CC0 1.0',
        start=0.0, dur=3.1, loop=None, stereo=False,
        desc='Heavy machine gun burst, rapid.'),
    'aa_gun_burst_1': dict(kind='sfx', srcid='fs-854186', url='https://cdn.freesound.org/previews/854/854186_71257-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/qubodup/sounds/854186/', author='qubodup (Freesound)', licence='CC0 1.0',
        start=0.0, dur=1.95, loop=None, stereo=False,
        desc='Autocannon three-shot burst.'),
    'rpg_launch_1': dict(kind='sfx', srcid='fs-249298', url='https://cdn.freesound.org/previews/249/249298_181941-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/klangfabrik/sounds/249298/', author='klangfabrik (Freesound)', licence='CC0 1.0',
        start=0.08, dur=2.5, loop=None, stereo=False,
        desc='Rocket launcher shot, first of three.'),
    'rpg_launch_2': dict(kind='sfx', srcid='fs-100772', url='https://cdn.freesound.org/previews/100/100772_1386366-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/CGEffex/sounds/100772/', author='CGEffex (Freesound)', licence='CC BY 4.0',
        start=0.0, dur=2.6, loop=None, stereo=False,
        desc='Heavy rocket launcher, launch bang and tail.'),
    'tank_cannon_1': dict(kind='sfx', srcid='fs-239135', url='https://cdn.freesound.org/previews/239/239135_71257-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/qubodup/sounds/239135/', author='qubodup (Freesound)', licence='CC0 1.0',
        start=0.0, dur=3.4, loop=None, stereo=False,
        desc='Tank shots, first shot of the recording (source title "Tank Shots").'),
    'tank_cannon_2': dict(kind='sfx', srcid='fs-189344', url='https://cdn.freesound.org/previews/189/189344_71257-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/qubodup/sounds/189344/', author='qubodup (Freesound)', licence='CC0 1.0',
        start=0.12, dur=3.3, loop=None, stereo=False,
        desc='Tanks shooting, first shot of the recording (source title "Tanks Shooting").'),
    'explosion_big_1': dict(kind='sfx', srcid='fs-177556', url='https://cdn.freesound.org/previews/177/177556_1423336-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Hugofski/sounds/177556/', author='Hugofski (Freesound)', licence='CC0 1.0',
        start=0.0, dur=5.5, loop=None, stereo=False,
        desc='Massive explosion with sustained rumble.'),
    'explosion_big_2': dict(kind='sfx', srcid='fs-760509', url='https://cdn.freesound.org/previews/760/760509_5487341-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/SamsterBirdies/sounds/760509/', author='SamsterBirdies (Freesound)', licence='CC0 1.0',
        start=0.0, dur=6.5, loop=None, stereo=False,
        desc='Astronomical explosion, long low tail (source title "Astronomical Explosion").'),
    'explosion_big_3': dict(kind='sfx', srcid='wm-Explosions-LS100150-ogg', url='https://upload.wikimedia.org/wikipedia/commons/1/19/Explosions-LS100150.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:Explosions-LS100150.ogg', author='Fg2, via Wikimedia Commons', licence='Public domain',
        start=0.33, dur=4.8, loop=None, stereo=False,
        desc='Series of explosions, heavy boom and decay.'),
    'explosion_med_1': dict(kind='sfx', srcid='fs-609587', url='https://cdn.freesound.org/previews/609/609587_1038806-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/unfa/sounds/609587/', author='unfa (Freesound)', licence='CC0 1.0',
        start=0.0, dur=2.2, loop=None, stereo=False,
        desc='Medium grenade-class explosion, meaty.'),
    'explosion_med_2': dict(kind='sfx', srcid='fs-563010', url='https://cdn.freesound.org/previews/563/563010_6253486-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/florianreichelt/sounds/563010/', author='florianreichelt (Freesound)', licence='CC0 1.0',
        start=0.15, dur=3.6, loop=None, stereo=False,
        desc='Explosion, broadband decay (source title "Explosion.mp3").'),
    'explosion_med_3': dict(kind='sfx', srcid='fs-516914', url='https://cdn.freesound.org/previews/516/516914_2247456-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Kinoton/sounds/516914/', author='Kinoton (Freesound)', licence='CC0 1.0',
        start=0.22, dur=3.3, loop=None, stereo=False,
        desc='Medium blast with a long tail.'),
    'explosion_small_1': dict(kind='sfx', srcid='fs-328833', url='https://cdn.freesound.org/previews/328/328833_4732572-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/dinodilopho/sounds/328833/', author='dinodilopho (Freesound)', licence='CC0 1.0',
        start=0.1, dur=1.2, loop=None, stereo=False,
        desc='Small explosion, grenade size.'),
    'explosion_small_2': dict(kind='sfx', srcid='fs-258195', url='https://cdn.freesound.org/previews/258/258195_2276808-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Kodack/sounds/258195/', author='Kodack (Freesound)', licence='CC0 1.0',
        start=0.0, dur=2.6, loop=None, stereo=False,
        desc='Deep small explosion.'),
    'explosion_distant_1': dict(kind='sfx', srcid='fs-149966', url='https://cdn.freesound.org/previews/149/149966_2514850-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/NenadSimic/sounds/149966/', author='NenadSimic (Freesound)', licence='CC0 1.0',
        start=0.0, dur=4.0, loop=None, stereo=False,
        desc='Muffled distant explosion.'),
    'explosion_distant_2': dict(kind='sfx', srcid='fs-438693', url='https://cdn.freesound.org/previews/438/438693_2524442-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/craigsmith/sounds/438693/', author='craigsmith (Freesound)', licence='CC0 1.0',
        start=5.9, dur=5.5, loop=None, stereo=False,
        desc='Distant explosions, first event of the cut (source title "G43-14-25 Distant Explosions").'),
    'debris_rain_1': dict(kind='sfx', srcid='fs-675728', url='https://cdn.freesound.org/previews/675/675728_2524442-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/craigsmith/sounds/675728/', author='craigsmith (Freesound)', licence='CC0 1.0',
        start=0.75, dur=5.0, loop=None, stereo=False,
        desc='Rock and dirt debris falling after a blast.'),
    'debris_rain_2': dict(kind='sfx', srcid='fs-703247', url='https://cdn.freesound.org/previews/703/703247_13504080-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/xkeril/sounds/703247/', author='xkeril (Freesound)', licence='CC0 1.0',
        start=0.0, dur=2.3, loop=None, stereo=False,
        desc='Big falling debris, crash.'),
    'fire_loop': dict(kind='sfx', srcid='fs-729313', url='https://cdn.freesound.org/previews/729/729313_10497906-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Tegeirian/sounds/729313/', author='Tegeirian (Freesound)', licence='CC0 1.0',
        start=0.0, dur=None, loop=(6.0, 0.6), stereo=False,
        desc='Burning crackle loop.'),
    'fire_large_loop': dict(kind='sfx', srcid='fs-730704', url='https://cdn.freesound.org/previews/730/730704_5828667-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/newlocknew/sounds/730704/', author='newlocknew (Freesound)', licence='CC BY 4.0',
        start=20.0, dur=None, loop=(8.0, 1.0), stereo=False,
        desc='Roaring campfire flame loop.'),
    'ricochet_1': dict(kind='sfx', srcid='fs-392975', url='https://cdn.freesound.org/previews/392/392975_5937039-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/morganpurkis/sounds/392975/', author='morganpurkis (Freesound)', licence='CC0 1.0',
        start=0.0, dur=0.75, loop=None, stereo=False,
        desc='Bullet ricochet, metallic ping with ring.'),
    'ricochet_2': dict(kind='sfx', srcid='fs-30932', url='https://cdn.freesound.org/previews/30/30932_15696-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/aust_paul/sounds/30932/', author='aust_paul (Freesound)', licence='CC0 1.0',
        start=0.0, dur=0.95, loop=None, stereo=False,
        desc='Bullet ricochet, double ping.'),
    'ricochet_3': dict(kind='sfx', srcid='fs-478345', url='https://cdn.freesound.org/previews/478/478345_9961300-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Joao_Janz/sounds/478345/', author='Joao_Janz (Freesound)', licence='CC0 1.0',
        start=0.0, dur=2.8, loop=None, stereo=False,
        desc='Bullet ricochet (source title "Bullet Ricochet 1_3").'),
    'ricochet_4': dict(kind='sfx', srcid='fs-394187', url='https://cdn.freesound.org/previews/394/394187_7280678-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/saturdaysoundguy/sounds/394187/', author='saturdaysoundguy (Freesound)', licence='CC0 1.0',
        start=0.04, dur=1.0, loop=None, stereo=False,
        desc='Ricochet with a sharp ping.'),
    'bullet_flyby_1': dict(kind='sfx', srcid='fs-134024', url='https://cdn.freesound.org/previews/134/134024_2451120-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Audionautics/sounds/134024/', author='Audionautics (Freesound)', licence='CC BY 3.0',
        start=1.03, dur=0.5, loop=None, stereo=False,
        desc='Bullet cracking past, single pass.'),
    'bullet_flyby_2': dict(kind='sfx', srcid='fs-123222', url='https://cdn.freesound.org/previews/123/123222_1386366-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/CGEffex/sounds/123222/', author='CGEffex (Freesound)', licence='CC BY 4.0',
        start=0.3, dur=1.0, loop=None, stereo=False,
        desc='Bullet whizzing past.'),
    'bullet_flyby_3': dict(kind='sfx', srcid='fs-505238', url='https://cdn.freesound.org/previews/505/505238_150886-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Daleonfire/sounds/505238/', author='Daleonfire (Freesound)', licence='CC0 1.0',
        start=0.56, dur=0.9, loop=None, stereo=False,
        desc='Whizz-by with Doppler.'),
    'bullet_impact_dirt_1': dict(kind='sfx', srcid='fs-150837', url='https://cdn.freesound.org/previews/150/150837_2728422-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/toxicwafflezz/sounds/150837/', author='toxicwafflezz (Freesound)', licence='CC BY 3.0',
        start=0.0, dur=0.72, loop=None, stereo=False,
        desc='Bullet impact in dirt.'),
    'bullet_impact_dirt_2': dict(kind='sfx', srcid='fs-319222', url='https://cdn.freesound.org/previews/319/319222_3443504-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/worthahep88/sounds/319222/', author='worthahep88 (Freesound)', licence='CC0 1.0',
        start=0.27, dur=1.2, loop=None, stereo=False,
        desc='Rock hitting dirt.'),
    'bullet_impact_wall_1': dict(kind='sfx', srcid='fs-423301', url='https://cdn.freesound.org/previews/423/423301_8202639-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/u1769092/sounds/423301/', author='u1769092 (Freesound)', licence='CC0 1.0',
        start=0.0, dur=0.5, loop=None, stereo=False,
        desc='Visceral bullet impacts, first impact (source title "VisceralBulletImpacts"). No dedicated wall recording was found.'),
    'bullet_impact_wall_2': dict(kind='sfx', srcid='fs-789388', url='https://cdn.freesound.org/previews/789/789388_15956618-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/modusmogulus/sounds/789388/', author='modusmogulus (Freesound)', licence='CC0 1.0',
        start=0.0, dur=0.95, loop=None, stereo=False,
        desc='Bullet impact on ground, subsonic (source title "Bullet impact ground"). Stand-in for a wall impact.'),
    'armor_hit_heavy_1': dict(kind='sfx', srcid='fs-789214', url='https://cdn.freesound.org/previews/789/789214_13973196-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Vrymaa/sounds/789214/', author='Vrymaa (Freesound)', licence='CC0 1.0',
        start=0.27, dur=3.6, loop=None, stereo=False,
        desc='Huge metallic impact with long ring.'),
    'armor_hit_heavy_2': dict(kind='sfx', srcid='fs-568786', url='https://cdn.freesound.org/previews/568/568786_1650856-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/tomwilkinson/sounds/568786/', author='tomwilkinson (Freesound)', licence='CC0 1.0',
        start=0.66, dur=2.0, loop=None, stereo=False,
        desc='Heavy metallic clang.'),
    'missile_salvo_1': dict(kind='sfx', srcid='fs-190469', url='https://cdn.freesound.org/previews/190/190469_3524188-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Alxy/sounds/190469/', author='Alxy (Freesound)', licence='CC BY 4.0',
        start=0.0, dur=2.6, loop=None, stereo=False,
        desc='Rapid succession of small rocket launches.'),
    'missile_salvo_2': dict(kind='sfx', srcid='fs-151858', url='https://cdn.freesound.org/previews/151/151858_2754532-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/NHMWretched/sounds/151858/', author='NHMWretched (Freesound)', licence='CC0 1.0',
        start=0.0, dur=4.1, loop=None, stereo=False,
        desc='Missile firing (source title "Missile firing fl").'),
    'rocket_loop': dict(kind='sfx', srcid='fs-515122', url='https://cdn.freesound.org/previews/515/515122_6142149-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/LilMati/sounds/515122/', author='LilMati (Freesound)', licence='CC0 1.0',
        start=10.0, dur=None, loop=(6.0, 0.8), stereo=False,
        desc='Rocket motor thrust loop.'),
    'flare_launch_1': dict(kind='sfx', srcid='fs-399208', url='https://cdn.freesound.org/previews/399/399208_6142149-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/LilMati/sounds/399208/', author='LilMati (Freesound)', licence='CC0 1.0',
        start=0.12, dur=1.3, loop=None, stereo=False,
        desc='Flare-style pop, recorded wrapper pop (source title "Wrapper Flare / Pop").'),
    'flare_launch_2': dict(kind='sfx', srcid='fs-399210', url='https://cdn.freesound.org/previews/399/399210_6142149-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/LilMati/sounds/399210/', author='LilMati (Freesound)', licence='CC0 1.0',
        start=0.03, dur=0.7, loop=None, stereo=False,
        desc='Short flare-style pop, recorded wrapper pop (source title "Wrapper Flare / Pop").'),
    'flare_burn_loop': dict(kind='sfx', srcid='fs-348766', url='https://cdn.freesound.org/previews/348/348766_299928-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/frankelmedico/sounds/348766/', author='frankelmedico (Freesound)', licence='CC0 1.0',
        start=2.0, dur=None, loop=(6.0, 0.8), stereo=False,
        desc='Hissing burning road flare loop.'),
    'sonic_boom_1': dict(kind='sfx', srcid='wm-Sonic-boom-massive-sound-ogg', url='https://upload.wikimedia.org/wikipedia/commons/d/df/Sonic-boom-massive-sound.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:Sonic-boom-massive-sound.ogg', author='AirMan, via Wikimedia Commons', licence='CC BY 3.0',
        start=0.0, dur=7.35, loop=None, stereo=False,
        desc='Massive sonic boom from a fighter breaking the sound barrier.'),
    'truck_engine_loop': dict(kind='sfx', srcid='fs-186935', url='https://cdn.freesound.org/previews/186/186935_545448-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/ReadeOnly/sounds/186935/', author='ReadeOnly (Freesound)', licence='CC0 1.0',
        start=0.0, dur=None, loop=(5.0, 0.8), stereo=False,
        desc='Diesel engine idling loop (source title "engine_idle_loop").'),
    'tank_engine_loop': dict(kind='sfx', srcid='fs-329800', url='https://cdn.freesound.org/previews/329/329800_1204841-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/greatmganga/sounds/329800/', author='greatmganga (Freesound)', licence='CC0 1.0',
        start=2.0, dur=None, loop=(8.0, 1.0), stereo=False,
        desc='Tracked military vehicle moving (source title "t26 moving").'),
    'jet_flyby_1': dict(kind='sfx', srcid='wm-WWS-SaabJ35DDraken8211passingtwotimes-ogg', url='https://upload.wikimedia.org/wikipedia/commons/5/5c/WWS_SaabJ35DDraken8211passingtwotimes.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:WWS_SaabJ35DDraken8211passingtwotimes.ogg', author='Torsten Nilsson / Work With Sounds, via Wikimedia Commons', licence='CC BY 4.0',
        start=9.0, dur=7.5, loop=None, stereo=False,
        desc='Fighter jet passing close and fast (Saab Draken).'),
    'jet_flyby_2': dict(kind='sfx', srcid='fs-135495', url='https://cdn.freesound.org/previews/135/135495_92661-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/FreqMan/sounds/135495/', author='FreqMan (Freesound)', licence='CC0 1.0',
        start=19.0, dur=8.0, loop=None, stereo=False,
        desc='F/A-18 hornet passing close and fast.'),
    'jet_flyby_3': dict(kind='sfx', srcid='fs-324370', url='https://cdn.freesound.org/previews/324/324370_181941-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/klangfabrik/sounds/324370/', author='klangfabrik (Freesound)', licence='CC0 1.0',
        start=3.0, dur=8.0, loop=None, stereo=False,
        desc='F-15 flyover, close pass.'),
    'jet_engine_loop': dict(kind='sfx', srcid='fs-322178', url='https://cdn.freesound.org/previews/322/322178_754558-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/ikbenraar/sounds/322178/', author='ikbenraar (Freesound)', licence='CC0 1.0',
        start=30.0, dur=None, loop=(8.0, 1.0), stereo=False,
        desc='Fighter jet engine at steady power, cut from a start-up recording (source title "F16 fighter jet start up").'),
    'missile_lock_loop': dict(kind='sfx', srcid='fs-189327', url='https://cdn.freesound.org/previews/189/189327_3524188-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Alxy/sounds/189327/', author='Alxy (Freesound)', licence='CC0 1.0',
        start=0.0, dur=None, loop=(2.6, 0.3), stereo=False,
        desc='Missile lock warning beeping.'),
    'desert_wind_loop': dict(kind='sfx', srcid='fs-697217', url='https://cdn.freesound.org/previews/697/697217_7678208-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/dhallcomposer/sounds/697217/', author='dhallcomposer (Freesound)', licence='CC0 1.0',
        start=0.0, dur=None, loop=(12.0, 1.0), stereo=True,
        desc='Gentle wind over an open desert plain (source title "Looping Gentle Wind Ambience").'),
    'village_ambience_loop': dict(kind='sfx', srcid='fs-705299', url='https://cdn.freesound.org/previews/705/705299_1661766-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/felix.blume/sounds/705299/', author='felix.blume (Freesound)', licence='CC0 1.0',
        start=10.0, dur=None, loop=(20.0, 2.0), stereo=True,
        desc='Small village at night, dogs barking in the distance (source title "Dogs barking far with echo in a small village at night").'),
    'crowd_panic_1': dict(kind='sfx', srcid='fs-491405', url='https://cdn.freesound.org/previews/491/491405_9616576-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/IENBA/sounds/491405/', author='IENBA (Freesound)', licence='CC0 1.0',
        start=0.1, dur=10.5, loop=None, stereo=False,
        desc='Crowd in panic (source title "Crowd in panic").'),
    'dog_bark_1': dict(kind='sfx', srcid='fs-332176', url='https://cdn.freesound.org/previews/332/332176_3474310-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/ivolipa/sounds/332176/', author='ivolipa (Freesound)', licence='CC0 1.0',
        start=0.1, dur=1.35, loop=None, stereo=False,
        desc='Aggressive dog barks.'),
    'dog_bark_2': dict(kind='sfx', srcid='fs-361544', url='https://cdn.freesound.org/previews/361/361544_6512973-hq.mp3', ext='.mp3',
        page='https://freesound.org/people/Jofae/sounds/361544/', author='Jofae (Freesound)', licence='CC0 1.0',
        start=0.25, dur=1.65, loop=None, stereo=False,
        desc='Small dog barking.'),
    'music_approach': dict(kind='music', srcid='wm-Kevin-MacLeod-Call-to-Adventure-ogg', url='https://upload.wikimedia.org/wikipedia/commons/1/17/Kevin_MacLeod_-_Call_to_Adventure.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Call_to_Adventure.ogg', author='Kevin MacLeod (incompetech.com), via Wikimedia Commons', licence='CC BY 3.0',
        start=0.0, dur=None, loop=(120.0, 3.0), stereo=True,
        desc='Call to Adventure (Kevin MacLeod). Heroic orchestral theme, loopable.'),
    'music_combat': dict(kind='music', srcid='wm-Kevin-MacLeod-Devastation-and-Revenge-ogg', url='https://upload.wikimedia.org/wikipedia/commons/5/5a/Kevin_MacLeod_-_Devastation_and_Revenge.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Devastation_and_Revenge.ogg', author='Kevin MacLeod (incompetech.com), via Wikimedia Commons', licence='CC BY 3.0',
        start=50.0, dur=None, loop=(100.0, 3.0), stereo=True,
        desc='Devastation and Revenge (Kevin MacLeod). Dark cinematic combat track, loopable.'),
    'music_chase': dict(kind='music', srcid='wm-Kevin-MacLeod-06-Hustle-ogg', url='https://upload.wikimedia.org/wikipedia/commons/f/fb/Kevin_MacLeod_-_06_-_Hustle.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_06_-_Hustle.ogg', author='Kevin MacLeod (incompetech.com), via Wikimedia Commons', licence='CC BY 3.0',
        start=0.0, dur=None, loop=(110.0, 3.0), stereo=True,
        desc='06 - Hustle (Kevin MacLeod). Fast driving action track, loopable.'),
    'music_victory': dict(kind='music', srcid='wm-Kevin-MacLeod-Running-Fanfare-ogg', url='https://upload.wikimedia.org/wikipedia/commons/7/7d/Kevin_MacLeod_-_Running_Fanfare.ogg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', ext='.ogg',
        page='https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Running_Fanfare.ogg', author='Kevin MacLeod (incompetech.com), via Wikimedia Commons', licence='CC BY 3.0',
        start=0.0, dur=22.0, loop=None, stereo=True,
        desc='Running Fanfare (Kevin MacLeod). Short fanfare outro.'),
}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(os.path.basename(cmd[0]) + ' failed:\n' + r.stderr[-800:])
    return r


def http_get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def fetch(name, s):
    d = os.path.join(CACHE, name, s['srcid'])
    os.makedirs(d, exist_ok=True)
    orig = os.path.join(d, 'orig' + s['ext'])
    if not (os.path.exists(orig) and os.path.getsize(orig) > 0):
        data = http_get(s['url'])
        with open(orig, 'wb') as f:
            f.write(data)
        time.sleep(1.5)
    with open(os.path.join(d, 'meta.json'), 'w') as f:
        json.dump({'url': s['url'], 'page': s['page'], 'author': s['author'],
                   'licence': s['licence']}, f, indent=1, ensure_ascii=False)
    return orig


def make_work(orig, s, work):
    chans = 2 if s['stereo'] else 1
    if s['loop']:
        d_len, x = s['loop']
        length = d_len + x
        fc = ('[0:a]asplit=3[a][b][c];'
              f'[a]atrim=0:{x},asetpts=PTS-STARTPTS[h];'
              f'[b]atrim={d_len}:{length},asetpts=PTS-STARTPTS[t];'
              f'[c]atrim={x}:{d_len},asetpts=PTS-STARTPTS[m];'
              f'[t][h]acrossfade=d={x}:c1=tri:c2=tri[xf];'
              '[xf][m]concat=n=2:v=0:a=1[out]')
    else:
        length = s['dur']
        fade = 2.0 if s['kind'] == 'music' else 0.03
        fc = f'[0:a]afade=t=out:st={length - fade:.3f}:d={fade}[out]'
    run([FFMPEG, '-y', '-v', 'error', '-ss', str(s['start']), '-t', str(length), '-i', orig,
         '-filter_complex', fc, '-map', '[out]', '-ac', str(chans), '-ar', '44100',
         '-c:a', 'pcm_s16le', work])


def bake(name, s):
    orig = fetch(name, s)
    work = os.path.join(os.path.dirname(orig), 'work.wav')
    make_work(orig, s, work)
    target = -18.0 if s['kind'] == 'music' else -16.0
    r = run([FFMPEG, '-hide_banner', '-nostats', '-i', work, '-af',
             f'loudnorm=I={target}:TP=-1.3:LRA=11:print_format=json', '-f', 'null', '-'])
    m = json.loads(re.findall(r'\{[^{}]*\}', r.stderr)[-1])
    af = (f'loudnorm=I={target}:TP=-1.3:LRA=11:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}'
          f':measured_LRA={m["input_lra"]}:measured_thresh={m["input_thresh"]}'
          f':offset={m["target_offset"]}:linear=true'
          ',alimiter=limit=0.84:attack=1:release=30:level=disabled')
    folder = 'music' if s['kind'] == 'music' else 'sfx'
    out = os.path.join(OUT, folder, name + '.mp3')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    chans = 2 if (s['stereo'] or s['kind'] == 'music') else 1
    bitrate = '192k' if s['kind'] == 'music' else '160k'
    run([FFMPEG, '-y', '-v', 'error', '-i', work, '-af', af, '-ac', str(chans), '-ar', '44100',
         '-c:a', 'libmp3lame', '-b:a', bitrate, '-metadata', f'title={name}',
         '-metadata', f"comment=source: {s['page']} | licence: {s['licence']} | author: {s['author']}",
         out])
    os.remove(work)
    return out


def probe_dur(path):
    r = run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    return float(r.stdout.strip())


def measure(path):
    r = subprocess.run([FFMPEG, '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true',
                        '-f', 'null', '-'], capture_output=True, text=True)
    loud = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    peak = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', r.stderr)
    return (float(loud[-1]) if loud else None, float(peak[-1]) if peak else None)


def write_outputs():
    man = {'sfx': {}, 'music': {}}
    rows = []
    for name, s in SOURCES.items():
        folder = 'music' if s['kind'] == 'music' else 'sfx'
        path = os.path.join(OUT, folder, name + '.mp3')
        if not os.path.exists(path):
            continue
        rel = 'assets/audio/%s/%s.mp3' % (folder, name)
        dur = round(probe_dur(path), 2)
        entry = {'file': rel, 'dur': dur, 'loop': bool(s['loop'])}
        if s['loop']:
            entry['loopStart'] = 0.03
            entry['loopEnd'] = round(dur - 0.03, 2)
        loud, peak = measure(path)
        entry['lufs'] = loud
        entry['truePeakDb'] = peak
        entry['desc'] = s['desc']
        man[folder][name] = entry
        rows.append((name, rel, s))
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(man, f, indent=2, ensure_ascii=False)
        f.write('\n')
    lines = ['# Audio credits', '',
             'Every sound is a real recording or a field/studio sample under CC0 1.0, public domain, '
             'CC BY 3.0 or CC BY 4.0. Rebuilt by `tools/fetch-audio.py` from the SOURCES table there.',
             '', '| file | what it is | source page link | author | licence |',
             '|---|---|---|---|---|']
    for name, rel, s in rows:
        lines.append('| %s | %s | %s | %s | %s |' % (rel, s['desc'], s['page'], s['author'], s['licence']))
    lines += ['', 'Attribution required for CC BY entries: credit the author, link the source page, '
              'and say whether the file was edited (all files were trimmed, looped and loudness-normalised).', '']
    with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    return rows


def main(argv):
    if argv == ['--manifest']:
        write_outputs()
        print('manifest and credits written', flush=True)
        return
    names = argv or list(SOURCES)
    unknown = [n for n in names if n not in SOURCES]
    if unknown:
        sys.exit('unknown names: ' + ', '.join(unknown))
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        s = SOURCES[name]
        try:
            path = bake(name, s)
        except Exception as e:
            print('FAIL %s: %s' % (name, e), flush=True)
            continue
        loud, peak = measure(path)
        print('ok   %-22s %6.2fs  %s LUFS  peak %s dBFS' % (name, probe_dur(path), loud, peak), flush=True)
    write_outputs()
    print('manifest and credits written', flush=True)


if __name__ == '__main__':
    main(sys.argv[1:])

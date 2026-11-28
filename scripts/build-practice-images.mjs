/**
 * Build the curated picture-word image set for the new practice modes.
 *
 * Only words that can be drawn as a distinctive object, animal, food, place,
 * body part, vehicle, clothing item, or clearly depictable scene are included.
 * Every other word is written to the manifest with a reason.
 *
 * Source: OpenMoji 17.0.0, colour SVG, CC BY-SA 4.0.
 * The script copies only the used SVGs into assets/practice-images/openmoji.
 *
 * Usage:
 *   node scripts/build-practice-images.mjs
 *
 * Network is only needed when the OpenMoji metadata or an SVG is not cached in
 * .tmp-openmoji. The generated manifest and used SVGs are committed, so the
 * site and tests never fetch OpenMoji at runtime.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(REPO, ".tmp-openmoji");
const VERSION = "17.0.0";
const RAW = `https://raw.githubusercontent.com/hfg-gmuend/openmoji/${VERSION}`;
const IMAGE_DIR = path.join(REPO, "assets", "practice-images", "openmoji");
const DATA_DIR = path.join(REPO, "data", "practice-modes-20261128");

/** headword -> [hexcode, distractor family, optional note] */
const PICKS = [
  // Beginner: concrete, recognisable nouns.
  ["가방", "1F392", "household"],
  ["건물", "1F3E2", "places"],
  ["경찰", "1F46E", "people"],
  ["고양이", "1F431", "nature"],
  ["공원", "1F3DE", "places"],
  ["공항", "1F6EB", "places"],
  ["공책", "1F4D3", "stationery"],
  ["과자", "1F36A", "food"],
  ["교실", "1F3EB", "places"],
  ["구름", "2601", "nature"],
  ["국수", "1F35C", "food"],
  ["귀", "1F442", "body"],
  ["꽃", "1F338", "nature"],
  ["편지", "2709", "stationery"],
  ["돈", "1F4B0", "money"],
  ["돼지", "1F437", "nature"],
  ["문", "1F6AA", "household"],
  ["바다", "1F30A", "nature"],
  ["발", "1F9B6", "body"],
  ["병원", "1F3E5", "places"],
  ["빵", "1F35E", "food"],
  ["사과", "1F34E", "food"],
  ["사진", "1F5BC", "stationery"],
  ["산", "26F0", "nature"],
  ["선생님", "1F9D1-200D-1F3EB", "people"],
  ["소금", "1F9C2", "food"],
  ["숟가락", "1F944", "household"],
  ["신문", "1F4F0", "stationery"],
  ["안경", "1F453", "body"],
  ["연필", "270F", "stationery"],
  ["옷", "1F455", "body"],
  ["운동장", "1F3DF", "places"],
  ["자동차", "1F697", "transport"],
  ["자전거", "1F6B2", "transport"],
  ["장갑", "1F9E4", "body"],
  ["전화", "260E", "household"],
  ["지갑", "1F45B", "money"],
  ["지도", "1F5FA", "stationery"],
  ["집", "1F3E0", "places"],
  ["책", "1F4D6", "stationery"],
  ["학생", "1F9D1-200D-1F393", "people"],
  ["할머니", "1F475", "people"],
  ["할아버지", "1F474", "people"],
  ["거울", "1FA9E", "household"],
  ["간호사", "1F469-200D-2695-FE0F", "people"],
  ["그릇", "1F963", "household"],
  ["교과서", "1F4D8", "stationery"],
  ["달걀", "1F95A", "food"],
  ["동전", "1FA99", "money"],
  ["열쇠", "1F511", "household"],
  ["우체국", "1F3E4", "places"],
  ["음료수", "1F964", "food"],
  ["음식", "1F371", "food"],
  ["얼굴", "1F60A", "body"],
  ["운동", "1F3C3", "body"],
  // Intermediate: only clear, concrete cases.
  ["간판", "1FAA7", "places"],
  ["국물", "1F372", "food"],
  ["낙엽", "1F342", "nature"],
  ["식기", "1F37D", "household"],
  ["온천", "2668", "places"],
  // Advanced: a small, conservative set.
  ["교량", "1F309", "transport"],
  ["구급차", "1F691", "transport"],
  ["소화기", "1F9EF", "household"],
  ["장바구니", "1F9FA", "household"],
  ["공사장", "1F3D7", "places"],
  ["주택가", "1F3D8", "places"],
];

/** Related families used only when a family has fewer than four pictures. */
const FALLBACKS = {
  money: ["household", "food", "stationery"],
  body: ["household", "nature", "people"],
  transport: ["places", "household", "nature"],
  nature: ["food", "places", "body"],
  food: ["household", "nature", "stationery"],
  places: ["household", "transport", "nature"],
  people: ["body", "places", "household"],
  household: ["stationery", "food", "places"],
  stationery: ["household", "places", "people"],
};

/** Explicit reasons for words that could otherwise look arbitrary. */
const SPECIAL_REASONS = {
  가격: ["abstract", "Price is an abstract value; a coin or money bag would depict money, not price."],
  기분: ["abstract", "Mood is an internal state; a face would show a specific emotion, not the general word."],
  문제: ["abstract", "Problem/question is an abstract idea, not a distinctive object."],
  이름: ["abstract", "Name is an abstract label; no text or letters may appear on the images."],
  공부: ["abstract", "Study is an activity/idea without a single distinctive object."],
  교통: ["abstract", "Traffic is a system/idea, not one depictable object."],
  나이: ["abstract", "Age is an abstract number, not a depictable object."],
  휴가: ["time", "Leave/vacation is an abstract period, not an object or scene."],
  휴일: ["time", "Holiday/rest day is an abstract calendar concept."],
  시간: ["time", "Time is an abstract concept, not a depictable object."],
  계절: ["time", "Season is an abstract division of the year."],
  겨울: ["time", "Winter is a season, not a single distinctive object."],
  여름: ["time", "Summer is a season, not a single distinctive object."],
  날씨: ["abstract", "Weather is a general condition, not one distinctive scene."],
  바람: ["abstract", "Wind is invisible; a wind-face icon would be a symbol, not a depiction of the noun."],
  냄새: ["abstract", "Smell is invisible and cannot be shown as a distinctive object."],
  소음: ["abstract", "Noise is an abstract quality, not a distinctive object."],
  음악: ["abstract", "Music is an abstract art form; note symbols would be textual/graphic symbols rather than the noun."],
  노래: ["abstract", "Song is an abstract work, not a single depictable object."],
  사랑: ["abstract", "Love is an emotion, not a depictable object."],
  생각: ["abstract", "Thought is an internal process, not a depictable object."],
  꿈: ["abstract", "Dream is an internal experience, not a depictable object."],
  마음: ["abstract", "Mind/heart as an inner state is not a depictable object."],
  부모님: ["person-role", "Parents are a family relationship; a family emoji would depict a specific family, not the role."],
  남자: ["person-role", "A generic man is not visually distinguishable from other person nouns without stereotypes."],
  아버지: ["person-role", "Father is a relationship role, not a visually distinctive person."],
  어머니: ["person-role", "Mother is a relationship role, not a visually distinctive person."],
  친구: ["person-role", "Friend is a relationship role, not a visually distinctive person."],
  손님: ["person-role", "Guest is a social role without a distinctive visual marker."],
  이름: ["abstract", "Name is an abstract label; images must not contain letters or Hangul."],
  공부: ["abstract", "Study is a general activity, not a single distinctive object or scene."],
  교통: ["abstract", "Traffic is a transport system, not one concrete object."],
  휴가: ["time", "Vacation leave is an abstract period, not an object."],
  휴일: ["time", "A day off is a calendar concept, not an object."],
  부엌: ["place-no-icon", "Kitchen is a room; a cooking pan would depict cooking, not the room."],
  도서관: ["place-no-icon", "Library is a building/service; a stack of books would depict books, not the library."],
  거실: ["place-no-icon", "Living room is a room; a couch would depict furniture, not the room."],
  사무실: ["place-no-icon", "Office is a room/workplace; an office tower would duplicate the building item."],
  약국: ["place-no-icon", "Pharmacy is a shop; a pill would depict medicine, not the shop."],
  기숙사: ["place-no-icon", "Dormitory is a residential building without a distinctive icon."],
  고향: ["place-no-icon", "Hometown is an abstract place of origin, not a specific depictable scene."],
  나라: ["place-no-icon", "Country is an abstract political/geographic entity."],
  회사: ["place-no-icon", "Company is an organization, not a distinctive building."],
  객실: ["place-no-icon", "Guest room is a room; a bed would depict a bed, not the room."],
  광장: ["place-no-icon", "Plaza is an open urban space without a distinctive icon."],
  대리점: ["place-no-icon", "Agency shop is a business relationship, not a distinctive storefront."],
  구내식당: ["place-no-icon", "Staff cafeteria is a room/service; a meal would depict food, not the cafeteria."],
  무릎: ["body-no-icon", "Knee has no distinct approved icon; a leg icon would depict the whole leg."],
  피부: ["body-no-icon", "Skin is a surface/organ without a distinctive whole-object depiction."],
  관절: ["body-no-icon", "Joint is an internal body part; a bone icon would not identify the joint."],
  지문: ["body-no-icon", "Fingerprint is a pattern; no approved icon shows it without text-like ridges."],
  설탕: ["food-no-icon", "Sugar has no distinct icon; a candy icon would depict candy, not sugar."],
  간장: ["food-no-icon", "Soy sauce has no distinct icon; a bottle would not identify it."],
  고춧가루: ["food-no-icon", "Chili powder has no distinct icon; a pepper would depict a pepper, not powder."],
  두부: ["food-no-icon", "Tofu has no distinct icon in the approved set."],
  김치: ["food-no-icon", "Kimchi has no distinct icon in the approved set."],
  우표: ["object-no-icon", "Postage stamp has no distinct icon in the approved set; images may not contain text."],
  잡지: ["media-no-icon", "Magazine has no distinct icon; a book/newspaper would depict a different object."],
  책상: ["object-no-icon", "Desk has no distinct icon; a chair or computer would depict a different object."],
  무늬: ["abstract", "Pattern is an abstract visual quality, not a single object."],
  눈빛: ["abstract", "Gaze is an abstract expression, not a depictable object."],
  한숨: ["abstract", "Sigh is an action/emotion, not a distinctive object."],
  향기: ["abstract", "Fragrance is invisible, not a distinctive object."],
  습기: ["abstract", "Moisture is an abstract condition, not a distinctive object."],
  건조: ["abstract", "Dryness is an abstract condition, not a distinctive object."],
  운동: ["action", "Exercise is a general activity; a single running figure could be read as running."],
};

function defaultReason(item) {
  const tags = item.semanticTags || [];
  if (tags.includes("time-sequence")) return ["time", "Time, season, or calendar concept; not a distinctive object or scene."];
  if (tags.includes("people-family")) return ["person-role", "Person/relationship noun without a distinctive, unambiguous approved icon."];
  if (tags.includes("place")) return ["place-no-icon", "Place or room without a distinctive approved icon."];
  if (tags.includes("body-health")) return ["body-no-icon", "Body/health concept without a distinctive approved icon."];
  if (tags.includes("food-drink")) return ["food-no-icon", "Food or condiment without a distinct approved icon."];
  if (tags.includes("household-objects")) return ["object-no-icon", "Household object without a distinct approved icon."];
  if (tags.includes("clothing")) return ["clothing-no-icon", "Clothing item without a distinct approved icon."];
  if (tags.includes("transport-energy")) return ["transport-concept", "Transport/energy concept without a distinct vehicle or scene icon."];
  if (tags.includes("art-media-communication")) return ["media-no-icon", "Media or communication concept without a distinct approved icon."];
  if (tags.includes("education-language")) return ["abstract", "Education/language concept without a distinctive depictable object."];
  if (tags.includes("nature-weather")) return ["abstract", "Nature/weather concept without a distinctive depictable object."];
  return ["abstract", "Abstract or non-depictable concept; kept in text-only modes."];
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function cacheFile(name, url) {
  const target = path.join(CACHE, name);
  if (existsSync(target)) return readFile(target, "utf8");
  const body = await fetchText(url);
  await mkdir(CACHE, { recursive: true });
  await writeFile(target, body);
  return body;
}

function seededRank(id, salt) {
  return createHash("sha256").update(String(id) + "|" + salt).digest("hex");
}

function sortBySeed(ids, seed) {
  return ids.slice().sort((a, b) => seededRank(seed, a).localeCompare(seededRank(seed, b)));
}

function pickDistractors(entry, byFamily, allIds) {
  const order = (family) => sortBySeed(byFamily[family] || [], entry.id + ":" + family);
  const preferred = order(entry.family).filter((id) => id !== entry.id);
  const out = preferred.slice(0, 3);
  const seen = new Set([entry.id, ...out]);
  for (const family of FALLBACKS[entry.family] || []) {
    for (const id of order(family)) {
      if (out.length >= 3) break;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    if (out.length >= 3) break;
  }
  for (const id of sortBySeed(allIds, entry.id)) {
    if (out.length >= 3) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function main() {
  const vocab = JSON.parse(await readFile(path.join(REPO, "data/krdict-graded-300/graded-vocab-300.json"), "utf8"));
  const byHeadword = new Map(vocab.items.map((item) => [item.headwordKo, item]));
  const openmoji = JSON.parse(await cacheFile("openmoji.json", `${RAW}/data/openmoji.json`));
  const emojiByHex = new Map();
  for (const row of openmoji) {
    if (row.skintone) continue;
    if (!emojiByHex.has(row.hexcode)) emojiByHex.set(row.hexcode, row);
  }

  const picked = [];
  for (const [headword, hexcode, family, note] of PICKS) {
    const item = byHeadword.get(headword);
    if (!item) throw new Error(`unknown headword in PICKS: ${headword}`);
    const meta = emojiByHex.get(hexcode);
    if (!meta) throw new Error(`OpenMoji ${VERSION} has no ${hexcode} for ${headword}`);
    picked.push({ item, hexcode, family, note: note || "", meta });
  }

  const byFamily = {};
  const allIds = [];
  for (const row of picked) {
    (byFamily[row.family] ||= []).push(row.item.id);
    allIds.push(row.item.id);
  }

  const fileFor = (hexcode) => `assets/practice-images/openmoji/${hexcode}.svg`;
  const images = [];
  await mkdir(IMAGE_DIR, { recursive: true });
  for (const row of picked) {
    const svgUrl = `${RAW}/color/svg/${row.hexcode}.svg`;
    const svg = await cacheFile(`${row.hexcode}.svg`, svgUrl);
    if (/<text\b|<tspan\b/i.test(svg)) throw new Error(`${row.hexcode}.svg contains text`);
    await writeFile(path.join(REPO, fileFor(row.hexcode)), svg);
    images.push({
      id: row.item.id,
      grade: row.item.grade,
      headwordKo: row.item.headwordKo,
      glossZh: row.item.glossZh,
      glossEn: row.item.glossEn,
      posKo: row.item.posKo,
      semanticTags: row.item.semanticTags,
      family: row.family,
      note: row.note,
      emoji: row.meta.emoji,
      hexcode: row.hexcode,
      openmojiAnnotation: row.meta.annotation,
      openmojiAuthor: row.meta.openmoji_author,
      file: fileFor(row.hexcode),
      sourceUrl: svgUrl,
      license: "CC-BY-SA-4.0",
    });
  }

  const imageById = new Map(images.map((row) => [row.id, row]));
  for (const row of images) row.distractorIds = pickDistractors(row, byFamily, allIds);
  for (const row of images) {
    for (const id of row.distractorIds) {
      if (!imageById.has(id)) throw new Error(`distractor ${id} for ${row.id} has no image`);
      if (id === row.id) throw new Error(`self distractor for ${row.id}`);
    }
    if (new Set(row.distractorIds).size !== row.distractorIds.length) throw new Error(`duplicate distractor for ${row.id}`);
    if (row.distractorIds.length !== 3) throw new Error(`need 3 distractors for ${row.id}`);
  }

  const pickedIds = new Set(images.map((row) => row.id));
  const skipped = vocab.items.filter((item) => !pickedIds.has(item.id)).map((item) => {
    const [reasonCode, reason] = SPECIAL_REASONS[item.headwordKo] || defaultReason(item);
    return {
      id: item.id,
      grade: item.grade,
      headwordKo: item.headwordKo,
      glossZh: item.glossZh,
      posKo: item.posKo,
      semanticTags: item.semanticTags,
      reasonCode,
      reason,
    };
  });

  const union = new Set([...images.map((row) => row.id), ...skipped.map((row) => row.id)]);
  if (union.size !== vocab.items.length) throw new Error(`manifest covers ${union.size}/${vocab.items.length} words`);
  const byGrade = (rows) => rows.reduce((acc, row) => {
    acc[row.grade] = (acc[row.grade] || 0) + 1;
    return acc;
  }, {});

  const manifest = {
    schemaVersion: 1,
    id: "practice-images-20261128",
    generatedBy: "scripts/build-practice-images.mjs",
    generatedAt: new Date().toISOString(),
    sourceVocab: "data/krdict-graded-300/graded-vocab-300.json",
    imageSource: {
      project: "OpenMoji",
      version: VERSION,
      repository: "https://github.com/hfg-gmuend/openmoji",
      colorSvgBase: `${RAW}/color/svg/`,
      license: "CC-BY-SA-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      attribution: "All emojis designed by OpenMoji - the open-source emoji and icon project. License: CC BY-SA 4.0",
    },
    licenseBoundary: "OpenMoji images are CC BY-SA 4.0. They are kept in assets/practice-images/openmoji/ and are not part of the krdict text pack licensed CC BY-SA 2.0 KR.",
    reasonCodes: {
      abstract: "Abstract or non-depictable concept; kept in text-only modes.",
      time: "Time, season, or calendar concept; not a distinctive object or scene.",
      "person-role": "Person/relationship noun without a distinctive, unambiguous approved icon.",
      "place-no-icon": "Place or room without a distinctive approved icon.",
      "body-no-icon": "Body/health concept without a distinctive approved icon.",
      "food-no-icon": "Food or condiment without a distinct approved icon.",
      "object-no-icon": "Object without a distinct approved icon.",
      "clothing-no-icon": "Clothing item without a distinct approved icon.",
      "media-no-icon": "Media or communication concept without a distinct approved icon.",
      "transport-concept": "Transport/energy concept without a distinct vehicle or scene icon.",
      action: "General action without one unambiguous scene.",
    },
    counts: {
      total: vocab.items.length,
      picturable: images.length,
      skipped: skipped.length,
      byGrade: {
        picturable: byGrade(images),
        skipped: byGrade(skipped),
      },
    },
    images,
    skipped,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, "image-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const pack = {
    schemaVersion: 1,
    id: "practice-modes-20261128",
    generatedBy: "scripts/build-practice-images.mjs",
    sourceVocab: "data/krdict-graded-300/graded-vocab-300.json",
    imageManifest: "data/practice-modes-20261128/image-manifest.json",
    modeConfig: {
      pictureWord: { optionCount: 4, distractorsPerItem: 3, autoSpeak: false },
      pictureWordReverse: { optionCount: 4, autoSpeak: false },
      listenMeaning: { optionCount: 4, autoSpeak: false },
      spelling: {
        variants: ["fill", "assemble", "full"],
        acceptNfc: true,
        ignoreSpaces: true,
        optionalAudio: true,
      },
      flashcard: {
        typeAnswer: true,
        selfMark: true,
        requeueWrongInSession: true,
      },
      timedMatch: { defaultEnabled: false, seconds: 60, unfinishedCountsWrong: true },
    },
    credits: {
      openmoji: "All emojis designed by OpenMoji - the open-source emoji and icon project. License: CC BY-SA 4.0",
      openmojiLicenseFile: "assets/practice-images/openmoji/LICENSE-CC-BY-SA-4.0.txt",
      openmojiAttributionFile: "assets/practice-images/openmoji/ATTRIBUTION.md",
      krdict: "국립국어원 《한국어기초사전》 CC BY-SA 2.0 KR",
    },
  };
  await writeFile(path.join(DATA_DIR, "practice-modes-pack.json"), JSON.stringify(pack, null, 2) + "\n");

  const license = await cacheFile("LICENSE-CC-BY-SA-4.0.txt", `${RAW}/LICENSE.txt`);
  await writeFile(path.join(IMAGE_DIR, "LICENSE-CC-BY-SA-4.0.txt"), license);

  const attribution = [
    "# OpenMoji image attribution",
    "",
    "The SVGs in this directory are from OpenMoji 17.0.0 (colour SVG set).",
    "Source: https://github.com/hfg-gmuend/openmoji",
    "License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).",
    "",
    "Required credit:",
    "",
    "> All emojis designed by OpenMoji - the open-source emoji and icon project. License: CC BY-SA 4.0",
    "",
    "Only the SVGs actually used by the picture-word practice modes are copied here.",
    "These images are licensed separately from the krdict text pack (CC BY-SA 2.0 KR).",
    "",
    "| File | Emoji | OpenMoji annotation | Author |",
    "| --- | --- | --- | --- |",
    ...images.map((row) => `| ${row.file.split("/").pop()} | ${row.emoji} | ${row.openmojiAnnotation} | ${row.openmojiAuthor} |`),
    "",
  ].join("\n");
  await writeFile(path.join(IMAGE_DIR, "ATTRIBUTION.md"), attribution);

  console.log(`wrote ${images.length} images, ${skipped.length} skipped words`);
  console.log(`picturable by grade: ${JSON.stringify(byGrade(images))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

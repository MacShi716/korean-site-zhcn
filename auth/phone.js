/** Same country rules as the current demo gate. Submission uses E.164 only. */
export const REJECTED_DEMO_CODE = "000000";

export const COUNTRY_CODES = [
  { cc: "+86", label: "中国大陆", re: /^1[3-9]\d{9}$/, example: "13800138000" },
  { cc: "+82", label: "韩国", re: /^0?1[016789]\d{7,8}$/, example: "01012345678" },
  { cc: "+852", label: "香港", re: /^[4-9]\d{7}$/, example: "51234567" },
  { cc: "+853", label: "澳门", re: /^6\d{7}$/, example: "66123456" },
  { cc: "+886", label: "台湾", re: /^0?9\d{8}$/, example: "0912345678" },
  { cc: "+81", label: "日本", re: /^0?[789]0\d{8}$/, example: "09012345678" },
  { cc: "+65", label: "新加坡", re: /^[89]\d{7}$/, example: "81234567" },
  { cc: "+1", label: "美国/加拿大", re: /^[2-9]\d{2}[2-9]\d{6}$/, example: "2015550123" },
];

const KEEP_NATIONAL_ZERO = new Set(["+86", "+1", "+852", "+853", "+65"]);

export function countryByCode(cc) {
  return COUNTRY_CODES.find((item) => item.cc === cc) || null;
}

export function normalizePhone(cc, raw) {
  const info = countryByCode(cc);
  const digits = String(raw || "").replace(/[\s\-().]/g, "");
  if (!info || !/^\d+$/.test(digits) || !info.re.test(digits)) {
    return { ok: false, e164: "", national: "" };
  }
  const national = KEEP_NATIONAL_ZERO.has(info.cc) ? digits : digits.replace(/^0/, "");
  return { ok: true, e164: `${info.cc}${national}`, national, cc: info.cc };
}

export function isRejectedDemoCode(code) {
  return String(code || "").trim() === REJECTED_DEMO_CODE;
}

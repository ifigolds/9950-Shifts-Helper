import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "web", "public", "shift-import-template.xlsx");

const workbook = Workbook.create();

const templateSheet = workbook.worksheets.add("Shift Import");
const instructionsSheet = workbook.worksheets.add("Instructions");

templateSheet.showGridLines = false;
instructionsSheet.showGridLines = false;

templateSheet.getRange("A1:G1").merge();
templateSheet.getRange("A1").values = [["9950 Shift Import Template"]];
templateSheet.getRange("A1").format = {
  fill: "#1479D3",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};

templateSheet.getRange("A2:G3").merge();
templateSheet.getRange("A2").values = [[
  "Fill one shift per row. Required columns: date, start_time, end_time, title. Optional columns: shift_type, location, notes."
]];
templateSheet.getRange("A2").format = {
  fill: "#EFF6FF",
  font: { color: "#0F172A", size: 11 },
  wrapText: true,
  verticalAlignment: "center",
};

templateSheet.getRange("A5:G7").values = [
  ["date", "start_time", "end_time", "title", "shift_type", "location", "notes"],
  ["2026-04-25", "08:00", "16:00", "Morning Control", "Control Room", "Base South", "Bring radio and handover notebook"],
  ["2026-04-25", "16:00", "23:30", "Evening Patrol", "Patrol", "Gate A", "Night vehicle access check"],
];

templateSheet.getRange("A5:G5").format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};

templateSheet.getRange("A6:G7").format = {
  fill: "#FFFFFF",
};

templateSheet.getRange("A5:G7").format.borders = {
  top: { style: "thin", color: "#CBD5E1" },
  bottom: { style: "thin", color: "#CBD5E1" },
  left: { style: "thin", color: "#CBD5E1" },
  right: { style: "thin", color: "#CBD5E1" },
};

templateSheet.getRange("A6:A200").format.numberFormat = "@";
templateSheet.getRange("B6:C200").format.numberFormat = "@";
templateSheet.getRange("A5:G200").format.wrapText = true;
templateSheet.getRange("A:G").format.columnWidthPx = 180;
templateSheet.getRange("A1:G3").format.rowHeightPx = 32;
templateSheet.getRange("A5:G200").format.rowHeightPx = 26;
templateSheet.freezePanes.freezeRows(5);

instructionsSheet.getRange("A1:D1").merge();
instructionsSheet.getRange("A1").values = [["How to prepare the file"]];
instructionsSheet.getRange("A1").format = {
  fill: "#15803D",
  font: { bold: true, color: "#FFFFFF", size: 15 },
  horizontalAlignment: "center",
};

instructionsSheet.getRange("A3:D10").values = [
  ["Column", "Required", "Format", "Example"],
  ["date", "Yes", "YYYY-MM-DD", "2026-04-25"],
  ["start_time", "Yes", "HH:MM", "08:00"],
  ["end_time", "Yes", "HH:MM", "16:00"],
  ["title", "Yes", "Free text", "Morning Control"],
  ["shift_type", "No", "Free text", "Control Room"],
  ["location", "No", "Free text", "Base South"],
  ["notes", "No", "Free text", "Bring radio and notebook"],
];

instructionsSheet.getRange("A3:D3").format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};

instructionsSheet.getRange("A3:D10").format.wrapText = true;
instructionsSheet.getRange("A:D").format.columnWidthPx = 190;
instructionsSheet.getRange("A1:D10").format.rowHeightPx = 28;
instructionsSheet.freezePanes.freezeRows(3);

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const xlsxFile = await SpreadsheetFile.exportXlsx(workbook);
await xlsxFile.save(outputPath);

const check = await workbook.inspect({
  kind: "table",
  range: "Shift Import!A5:G7",
  include: "values",
  tableMaxRows: 3,
  tableMaxCols: 7,
});

console.log(check.ndjson);

import { createColors } from "picocolors";

type TableColumn<Row> = {
  align?: "left" | "right";
  key: keyof Row;
  label: string;
};

export interface CliOutput {
  error(message: string): void;
  info(message: string): void;
  json(value: unknown): void;
  line(message?: string): void;
  muted(value: string): string;
  success(message: string): void;
  table<Row extends Record<string, string>>(columns: TableColumn<Row>[], rows: Row[]): void;
  warn(message: string): void;
}

type TableRenderable = Record<string, string>;

function pad(value: string, width: number, align: "left" | "right" = "left"): string {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}

export function createCliOutput(options: {
  colorEnabled: boolean;
  json: boolean;
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
}): CliOutput {
  const colors = createColors(options.colorEnabled);
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  const stderr = options.stderr ?? ((line: string) => console.error(line));

  return {
    error(message) {
      stderr(options.json ? message : `${colors.red("error")}: ${message}`);
    },
    info(message) {
      stdout(message);
    },
    json(value) {
      stdout(JSON.stringify(value, null, 2));
    },
    line(message = "") {
      stdout(message);
    },
    muted(value) {
      return colors.dim(value);
    },
    success(message) {
      stdout(options.json ? message : `${colors.green("ok")}: ${message}`);
    },
    table<Row extends TableRenderable>(columns: TableColumn<Row>[], rows: Row[]) {
      if (rows.length === 0) {
        stdout(colors.dim("No results."));
        return;
      }

      const widths = new Map<keyof Row, number>();
      for (const column of columns) {
        const rowWidth = Math.max(...rows.map((row) => (row[column.key] ?? "").length));
        widths.set(column.key, Math.max(column.label.length, rowWidth));
      }

      const render = (row: TableRenderable) =>
        columns
          .map((column) => pad(String(row[column.key as string] ?? ""), widths.get(column.key) ?? 0, column.align))
          .join("  ");

      stdout(render(Object.fromEntries(columns.map((column) => [column.key, column.label]))));
      stdout(
        columns
          .map((column) => "-".repeat(widths.get(column.key) ?? column.label.length))
          .join("  "),
      );
      for (const row of rows) {
        stdout(render(row));
      }
    },
    warn(message) {
      stderr(options.json ? message : `${colors.yellow("warn")}: ${message}`);
    },
  };
}

export function formatBooleanState(value: boolean | undefined, enabled: boolean): string {
  const colors = createColors(enabled);
  if (value === true) {
    return colors.green("on");
  }
  if (value === false) {
    return colors.red("off");
  }
  return colors.dim("-");
}

import { EMPTY } from "../../lib/format";

/* Shows the first few characters of a secret and hides the rest.
 *
 * Replaces mask(), which returned an HTML string and so had to escape the
 * value itself before splicing it into markup. */

export function MaskedValue({ value, visible = 6 }: { value: string | null | undefined; visible?: number }) {
  if (!value) return <span className="mval">{EMPTY}</span>;
  return (
    <span className="mval" title="Partially hidden">
      {value.slice(0, visible)}
      ••••••
    </span>
  );
}

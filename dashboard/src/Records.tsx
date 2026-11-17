import { label, money, type Value } from "./api";

export function Records({ value }: Readonly<{ value: Value }>) {
  if (value === null) return <span>None</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ul className="records">
        {value.map((item, index) => (
          <li key={index}>
            <Records value={item} />
          </li>
        ))}
      </ul>
    ) : (
      <span>None</span>
    );
  if (typeof value === "object")
    return (
      <dl className="facts">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{label(key)}</dt>
            <dd>
              {typeof item === "number" &&
              /amount|cost|deductible|_max|_limit/.test(key) ? (
                money(item)
              ) : (
                <Records value={item} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{typeof value === "boolean" ? String(value) : value}</span>;
}

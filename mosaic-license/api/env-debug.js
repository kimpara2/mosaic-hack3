export default function handler(req, res) {
  const value = process.env.LICENSE_ADMIN_TOKEN;

  res.status(200).json({
    hasEnv: !!value,
    length: value ? value.length : 0,
    sample: value ? value.slice(0, 4) + "..." : null,
    keys: Object.keys(process.env).filter((k) =>
      k.toLowerCase().includes("license")
    ),
  });
}

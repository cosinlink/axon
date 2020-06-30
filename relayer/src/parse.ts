import snakecaseKeys from "snakecase-keys";

export function toCKBRPCType<RPC = any, Component = any>(x: Component) {
  return (snakecaseKeys(x, { deep: true }) as any) as RPC;
}

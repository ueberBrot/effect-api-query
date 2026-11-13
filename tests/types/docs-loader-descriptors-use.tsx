import { load, restore } from "./docs-loader-descriptors";
import type { Client } from "./docs-loader-descriptors";

declare const client: Client;
const transferred = await load(client, 1);
transferred satisfies string;
const restored = restore(client, transferred);
restored.App satisfies () => import("react").ReactElement;
restored.cache.clear();
// @ts-expect-error Loader input keeps its numeric ID contract.
await load(client, "1");

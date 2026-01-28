import { fileURLToPath } from "url";
import { dirname } from "path";

export const getDirname = (importMetaUrl: string): string => {
    const filename = fileURLToPath(importMetaUrl);
    return dirname(filename);
}
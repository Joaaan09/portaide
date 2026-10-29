// Estado del explorer que sobrevive a cambiar de vista. AppShell desmonta la
// vista inactiva, así que lo que viva en useState se pierde al volver a Files;
// esto vive a nivel de módulo (memoria de la sesión, no se persiste).
// Las claves son rutas absolutas, así que vale para cualquier workspace.
import type { FsEntry } from '../../api/client'

/** Carpetas expandidas. */
export const expandedDirs = new Set<string>()

/** Último listado conocido de cada carpeta: se pinta al instante al volver y
 *  se revalida en segundo plano (stale-while-revalidate). */
export const listings = new Map<string, FsEntry[]>()

/** Scroll del explorer, ligado al workspace en el que se tomó. */
export const scroll = { workspace: '', top: 0 }

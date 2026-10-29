// Guard anti cross-site para la API autenticada y los WS (CLAUDE.md §11).
// La PWA y la API comparten origen: nada legítimo llega desde otro sitio ni
// desde un origen opaco. Lo más importante que cubre es el <iframe sandbox> de
// la vista previa de HTML (fs/preview.ts): su JS corre DENTRO de la app con
// origen opaco y, si el navegador llegara a adjuntar la cookie, este guard es
// lo que le impide abrir /ws/terminal o tocar la FS API.
import type { IncomingMessage } from 'node:http';

/**
 * true si la petición viene de otro sitio (incluidos subdominios hermanos) o
 * de un origen opaco (`Origin: null`). Navegadores sin cabeceras Fetch Metadata
 * quedan cubiertos por la cookie SameSite=Lax.
 */
export function isCrossSite(req: IncomingMessage): boolean {
  if (req.headers.origin === 'null') return true;
  const site = req.headers['sec-fetch-site'];
  return site === 'cross-site' || site === 'same-site';
}

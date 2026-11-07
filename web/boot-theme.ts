// Тема до отрисовки, чтобы не мигало (отдельный файл — встроенные скрипты запрещены CSP).
import { applyTheme, readTheme } from "./lib/theme";

applyTheme(readTheme());

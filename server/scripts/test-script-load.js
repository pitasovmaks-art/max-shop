/* Проверка целостности загрузки статики: для каждой HTML-страницы
   (корневые *.html, admin/index.html, src/<любая глубина>/*.html) выполняет её
   локальные <script src="..."> по порядку в ОДНОМ vm-контексте — так
   же, как браузер выполняет несколько обычных (не module) <script> на
   одной странице в одном общем глобальном окружении.

   Ловит ровно тот класс багов, что уронил вход в админку (коммит
   7398a2f): два файла декларируют одно и то же верхнеуровневое имя
   (`const X` в одном, `function X` в другом) — второй из них бросает
   SyntaxError "Identifier 'X' has already been declared" при попытке
   объявить привязку в уже занятом глобальном окружении, и ВСЁ его
   содержимое отбрасывается (ни одна функция из этого файла не
   определяется), хотя сама страница продолжает загружаться дальше, как
   ни в чём не бывало — отсюда "admin.js не загружается, attemptLogin
   не существует" без единой ошибки в сети (файл отдаётся 200 OK).

   Также падает на отсутствующих локальных файлах (битый src).

   Не падает (намеренно) на ReferenceError/TypeError от обращения к
   отсутствующим в vm браузерным API (document, window, localStorage и
   т.п.) — GlobalDeclarationInstantiation (объявление верхнеуровневых
   const/let/class/function) происходит ДО выполнения тела скрипта, то
   есть ошибка редекларации гарантированно всплывёт независимо от того,
   что дальше код полезет в document; а полноценный DOM-стаб для всех
   страниц — избыточная сложность для того, что эта проверка должна
   ловить.

   Запуск: node server/scripts/test-script-load.js
*/
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function findHtmlFiles() {
    const files = [];
    for (const f of fs.readdirSync(ROOT)) {
        if (f.endsWith('.html')) files.push(path.join(ROOT, f));
    }
    const adminIndex = path.join(ROOT, 'admin', 'index.html');
    if (fs.existsSync(adminIndex)) files.push(adminIndex);

    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.html')) files.push(full);
        }
    }
    walk(path.join(ROOT, 'src'));
    return [...new Set(files)];
}

/* Локальные <script src="..."> в порядке появления в документе;
   внешние (http(s)://, протокол-относительные //) и инлайновые
   (без src) — пропускаются. */
function extractLocalScriptSrcs(html) {
    const srcs = [];
    const tagRe = /<script\b[^>]*>/gi;
    let m;
    while ((m = tagRe.exec(html))) {
        const tag = m[0];
        const srcMatch = tag.match(/\bsrc\s*=\s*"([^"]+)"/i) || tag.match(/\bsrc\s*=\s*'([^']+)'/i);
        if (!srcMatch) continue; // инлайн-скрипт
        const raw = srcMatch[1];
        if (/^(https?:)?\/\//i.test(raw)) continue; // внешний (CDN)
        srcs.push(raw);
    }
    return srcs;
}

/* Разрешение src в файл на диске — по тем же правилам, что
   server/index.js (STATIC_OPTS): /src, /public, /admin отражают
   одноимённые каталоги репозитория 1:1, корневые страницы живут в
   корне — поэтому "путь относительно каталога самой HTML-страницы"
   корректно разрешает и относительные, и ведущие-со-слешем src. */
function resolveScriptPath(htmlFilePath, rawSrc) {
    const withoutQuery = rawSrc.split('?')[0].split('#')[0];
    if (withoutQuery.startsWith('/')) {
        return path.join(ROOT, withoutQuery);
    }
    return path.join(path.dirname(htmlFilePath), withoutQuery);
}

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const htmlFiles = findHtmlFiles().sort();
    check(`найдены HTML-страницы (${htmlFiles.length})`, htmlFiles.length > 0);

    for (const htmlFile of htmlFiles) {
        const relHtml = path.relative(ROOT, htmlFile);
        const html    = fs.readFileSync(htmlFile, 'utf8');
        const srcs    = extractLocalScriptSrcs(html);

        let pageOk = true;
        const problems = [];
        const parts = []; // [{ relScript, code }] — только успешно прочитанные файлы

        for (const rawSrc of srcs) {
            const scriptPath = resolveScriptPath(htmlFile, rawSrc);
            const relScript  = path.relative(ROOT, scriptPath);

            if (!fs.existsSync(scriptPath)) {
                pageOk = false;
                problems.push(`файл не найден: ${relScript} (src="${rawSrc}")`);
                continue;
            }

            const code = fs.readFileSync(scriptPath, 'utf8');

            // 1) Синтаксис самого файла, по отдельности — чтобы при ошибке
            // точно указать, в каком конкретно файле она (compile-only,
            // без запуска: нам нужна только раскладка на верхнеуровневые
            // объявления, а не поведение браузерного кода).
            try {
                new vm.Script(code, { filename: scriptPath });
            } catch (e) {
                pageOk = false;
                problems.push(`${relScript}: ${e.name}: ${e.message}`);
                continue; // в объединённый скрипт битый файл не включаем
            }
            parts.push({ relScript, code });
        }

        // 2) Конфликты верхнеуровневых имён МЕЖДУ файлами — именно то, что
        // уронило вход в админку (коммит 7398a2f): `const _escHtml` в
        // admin.js и `function _escHtml` в banners.js, оба обычные
        // <script> на одной странице, одна область видимости. Несколько
        // раздельных vm.Script, выполненных по одному в один context, эту
        // ошибку не ловят надёжно (обнаружил эмпирически при проверке —
        // поведение зависит от ПОРЯДКА function/const и похоже на
        // особенность реализации vm в V8, не совпадающую с тем, что видит
        // браузер); а конкатенация всех локальных <script> страницы в ОДИН
        // исходный текст и компиляция его как одного vm.Script — именно
        // то же самое "общее глобальное окружение", и ловит конфликт
        // гарантированно (раннее/синтаксическое правило языка про
        // повторные lexical-объявления в одном Script, см. ECMA-262
        // GlobalDeclarationInstantiation) — это и есть "все локальные
        // <script> страницы в одном vm-контексте" из задачи.
        if (parts.length > 1) {
            const combined = parts.map(p => `// ---- ${p.relScript} ----\n${p.code}`).join('\n');
            try {
                const combinedScript = new vm.Script(combined, { filename: `${relHtml} (все <script> вместе)` });
                // Минимальный self-референс window/self/globalThis — не
                // DOM-стаб (не нужен для этой проверки), только чтобы не
                // шуметь ReferenceError-ами от кода вида `window.WebApp?.x`
                // в начале некоторых файлов — они гасятся try/catch внутри
                // самих файлов и ни на что не влияют.
                const sandbox = { console };
                sandbox.window = sandbox;
                sandbox.self = sandbox;
                sandbox.globalThis = sandbox;
                combinedScript.runInContext(vm.createContext(sandbox));
            } catch (e) {
                if (e instanceof SyntaxError) {
                    pageOk = false;
                    problems.push(`конфликт между файлами: ${e.name}: ${e.message}`);
                }
                // Иначе (ReferenceError/TypeError от отсутствующих браузерных
                // API) — не наша забота, игнорируем, как и выше.
            }
        }

        check(`${relHtml}: все локальные <script> (${srcs.length}) загружаются без SyntaxError/битых путей`, pageOk);
        if (!pageOk) problems.forEach(p => console.log(`   - ${p}`));
    }

    console.log(failures === 0
        ? '\n✅ Все проверки прошли'
        : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

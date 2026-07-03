export function renderPages(pageCount: number) {

    const container =
        document.querySelector(".screenplay-pages")

    if (!container) return

    container.innerHTML = ""

    for (let i = 0; i < pageCount; i++) {

        const page =
            document.createElement("div")

        page.className = "screenplay-page"

        const number =
            document.createElement("div")

        number.className = "page-number"

        if (i > 0)
            number.innerText = String(i + 1)

        page.appendChild(number)

        container.appendChild(page)

    }

}
const PAGE_HEIGHT = 864;

export function paginate(nodes: HTMLElement[]) {

    const pages: HTMLElement[][] = [];

    let page: HTMLElement[] = [];
    let height = 0;

    for (let i = 0; i < nodes.length; i++) {

        const node = nodes[i];
        const h = node.offsetHeight;

        const type = node.getAttribute("data-line-type");

        const isDialogue =
            type === "dialogue" ||
            type === "character" ||
            type === "parenthetical";

        if (height + h > PAGE_HEIGHT) {

            if (isDialogue) {

                while (
                    page.length &&
                    ["dialogue", "character", "parenthetical"]
                        .includes(
                            page[page.length - 1]
                                .getAttribute("data-line-type") || ""
                        )
                ) {
                    nodes.unshift(page.pop()!)
                }

            }

            pages.push(page);
            page = [];
            height = 0;

        }

        page.push(node);
        height += h;

    }

    if (page.length) pages.push(page);

    return pages;

}
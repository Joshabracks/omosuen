import constructElement from "./constructElement.js";
// Build the template into state.root (the resolved mount target). The caller
// (State.mount) owns clearing the target, resetting maps, and the document.title
// side-effect — this only constructs and appends.
function constructDOM(state) {
    const { template, root } = state;
    if (!root)
        return;
    const elements = [];
    for (let i = 0; i < template.length; i++) {
        const element = constructElement(template[i], `${i}`, state);
        elements.push(element);
    }
    elements.forEach((element) => root.appendChild(element));
}
export default constructDOM;

---
name: alias-taxonomy
description: Standard UI/component alias dictionary loaded by project-analyzer Phase 3. Maps common alias names to their required signal patterns (props, template elements, etc.) for evidence-based classification. Extend this file to add project-specific aliases.
---

# Component Alias Taxonomy

This dictionary is the source of truth for what a "button," "dropdown," "modal," etc. IS. The project-analyzer loads this during Phase 3 to classify each shared component against these patterns.

**Matching rule:** A component receives an alias IF it matches the required signals. At least 2 signals must match (filename alone is NEVER enough).

---

## FORM INPUTS

### button
- **Props:** label | text | icon, onClick | click | on-click, disabled?
- **Template:** `<button>` element, no input elements inside
- **Synonyms:** btn

### icon-button
- **Props:** icon (required), tooltip?, onClick
- **Template:** `<button>` with icon only, no text
- **Synonyms:** icon-btn

### input
- **Props:** model | value | ng-model, placeholder?, type? (text/email/number)
- **Template:** `<input type="text|email|number|password|tel">`
- **Synonyms:** text-input, text-field

### textarea
- **Props:** model | value, rows?, placeholder?
- **Template:** `<textarea>`

### select
- **Props:** items | options | choices, model | value | selected
- **Template:** `<select>` OR `<ui-select>` OR custom dropdown markup
- **Synonyms:** dropdown

### multi-select
- **Inherits:** select
- **Additional props:** multi | multiple (boolean)
- **Synonyms:** multi-dropdown, multiple-select

### searchable-select
- **Inherits:** select
- **Additional props:** searchable | search-enabled, search-query
- **Synonyms:** filterable-select

### autocomplete
- **Props:** source | suggestions | items, query | input
- **Template:** input + suggestion list
- **Synonyms:** typeahead, combobox

### radio
- **Props:** options | choices, model | value
- **Template:** `<input type="radio">` with ng-repeat or multiple siblings

### radio-group
- **Inherits:** radio
- **Additional:** grouped under a single name/label

### checkbox
- **Props:** model | checked (boolean), label?
- **Template:** single `<input type="checkbox">`

### checkbox-group
- **Props:** options | items, selected (array)
- **Template:** multiple `<input type="checkbox">` via ng-repeat/map

### toggle
- **Props:** model | checked (boolean), on?, off?
- **Template:** styled switch (often checkbox with CSS) or toggle button
- **Synonyms:** switch

### slider
- **Props:** min, max, model | value, step?
- **Template:** `<input type="range">` or custom slider

### file-upload
- **Props:** accept?, multiple?, onUpload | on-file
- **Template:** `<input type="file">` or drop zone
- **Synonyms:** file-input, file-drop

---

## SPECIALIZED PICKERS

### date-picker
- **Props:** date | value (Date type), min?, max?
- **Template:** calendar UI, date input
- **Synonyms:** calendar-picker

### date-range
- **Inherits:** date-picker
- **Additional props:** from | start, to | end, OR range object
- **Synonyms:** date-range-picker

### time-picker
- **Props:** time | value, format?
- **Template:** time input or clock UI

### datetime-picker
- **Inherits:** date-picker, time-picker

### color-picker
- **Props:** color | value (hex/rgb)
- **Template:** color swatch or palette

### user-picker
- **Inherits:** select
- **Additional indicator:** has a `users` prop OR filename contains "user"
- **Synonyms:** people-picker

### role-picker
- **Inherits:** select
- **Additional indicator:** has a `roles` prop OR filename contains "role"

### reviewer-picker
- **Inherits:** select
- **Additional indicator:** has a `reviewers` prop OR filename contains "reviewer"
- **Synonyms:** approver-picker (if approver context)

### group-picker
- **Inherits:** select
- **Additional indicator:** has a `groups` prop OR filename contains "group"

### entity-picker
- **Inherits:** select
- **Additional indicator:** generic entity selection (application, role, etc.)

---

## DATA DISPLAY

### table
- **Props:** columns, data | rows, sortable?, paginated?
- **Template:** `<table><thead><tbody>` structure
- **Synonyms:** grid, data-table

### grid
- **Synonyms for:** table
- **Distinction:** "grid" often implies feature-rich table (sort, filter, edit inline)

### data-grid
- **Synonyms:** grid

### list
- **Props:** items, itemTemplate?, onItemClick?
- **Template:** `<ul>` or custom list structure

### virtual-list
- **Inherits:** list
- **Additional indicator:** virtualization for large datasets (viewport, buffer)

### tree
- **Props:** nodes | items (with children), expanded?
- **Template:** recursive structure with expand/collapse
- **Synonyms:** tree-view

### tree-grid
- **Inherits:** tree + grid

### card
- **Props:** title?, content?, actions?
- **Template:** bordered container with header/body

### timeline
- **Props:** events | items (with timestamps)
- **Template:** vertical/horizontal sequence with markers

### calendar
- **Props:** events, date | month
- **Template:** grid of days with events

### chart
- **Props:** data, type (bar/line/pie/etc.)
- **Template:** SVG or canvas rendering

---

## LAYOUT & NAVIGATION

### tabs
- **Props:** tabs | items, activeTab | selected, onSwitch?
- **Template:** tab headers + content area

### accordion
- **Props:** panels | items, expanded?
- **Template:** collapsible sections

### breadcrumb
- **Props:** items | path, separator?
- **Template:** horizontal path links

### pagination
- **Props:** total, page | current, pageSize, onChange
- **Template:** page number buttons, prev/next

### stepper
- **Props:** steps | items, currentStep
- **Template:** horizontal/vertical step progression

### wizard
- **Props:** steps, onNext, onPrev
- **Template:** stepper + step content

### drawer
- **Props:** open | show, side (left/right), onClose
- **Template:** slide-in panel from edge

### sidebar
- **Synonyms for:** drawer (when always visible)

### panel
- **Props:** title?, collapsible?, actions?
- **Template:** bordered container

### fieldset
- **Props:** legend | title
- **Template:** grouped form controls

---

## FEEDBACK

### toast
- **Props:** message, type (success/error/warn/info), duration?
- **Template:** floating notification
- **Synonyms:** snackbar

### alert
- **Props:** message, type, dismissible?
- **Template:** inline message box

### banner
- **Props:** message, type, actions?
- **Template:** full-width page-level message

### notification
- **Synonyms:** toast or alert depending on placement

### loading
- **Props:** show | visible, message?
- **Template:** spinner or skeleton
- **Synonyms:** spinner, loader

### progress
- **Props:** value | percent, max?
- **Template:** progress bar or circle

### skeleton
- **Props:** shape (text/circle/rect), count?
- **Template:** placeholder during loading

### empty-state
- **Props:** icon?, message, action?
- **Template:** centered message with optional call-to-action

### error-state
- **Props:** error, retry?
- **Template:** error message with retry

---

## OVERLAY

### modal
- **Props:** show | visible, onClose, title?, size?
- **Template:** centered dialog with backdrop
- **Synonyms:** dialog

### confirm-dialog
- **Inherits:** modal
- **Additional props:** message, onConfirm, onCancel

### tooltip
- **Props:** content | text, placement?
- **Template:** hover-triggered popover

### popover
- **Props:** content, trigger, placement?
- **Template:** click-triggered popup

### bottom-sheet
- **Props:** show, onClose
- **Template:** slide-up panel from bottom (mobile pattern)

---

## DRAG & DROP

### drag-and-drop
- **Props:** items, onSort | onReorder | onDrop
- **Template:** draggable items with drop zones
- **Synonyms:** sortable, draggable

### sortable-list
- **Inherits:** list + drag-and-drop

### sortable-grid
- **Inherits:** grid + drag-and-drop

### resizable
- **Props:** onResize, minSize?, maxSize?
- **Template:** resize handles

### droppable
- **Props:** onDrop, accepts? (type filter)
- **Template:** drop zone target

---

## HOW TO EXTEND

To add project-specific aliases:

```markdown
### my-custom-widget
- **Props:** ...
- **Template:** ...
- **Synonyms:** ...
```

The analyzer loads this file on every scan — additions take effect immediately.

For domain-specific synonyms without adding a new primitive:

```markdown
### approver-picker
- **Inherits:** user-picker (same requirements)
- **Additional indicator:** filename contains "approver"
```

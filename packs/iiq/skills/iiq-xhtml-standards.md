---
name: iiq-xhtml-standards
description: XHTML template coding standards for IIQ pages. Loaded by Surgeon when task Layer = Frontend/XHTML.
---

# IIQ XHTML Template Standards

## Page Structure

```xml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
    xmlns:ui="http://java.sun.com/jsf/facelets"
    xmlns:h="http://java.sun.com/jsf/html"
    xmlns:f="http://java.sun.com/jsf/core"
    template="/ui/page/layout/simpleLayout.xhtml">

    <ui:define name="pageTitle">#{msgs.ui_feature_page_title}</ui:define>

    <ui:define name="head">
        <!-- Page-specific CSS if needed -->
    </ui:define>

    <ui:define name="body">
        <div ng-app="sailpoint.feature" ng-cloak>
            <div ng-controller="FeatureCtrl">
                <!-- Page content -->
            </div>
        </div>
    </ui:define>

    <ui:define name="scripts">
        <script type="text/javascript">
            SailPoint.addModule('sailpoint.feature');
        </script>
    </ui:define>
</ui:composition>
```

**Key rules:**
- Always use `ui:composition` with a layout template
- Only declare namespaces you use (`xmlns:h`, `xmlns:f` only if JSF tags are used)
- `ng-cloak` on Angular root to prevent template flash
- Register module via `SailPoint.addModule()` in the scripts section

## Angular Directives in XHTML

```xml
<!-- Directive as element -->
<sp-date-picker sp-config="dateConfig" sp-on-change="handleDateChange(date)">
</sp-date-picker>

<!-- Directive as attribute -->
<div sp-column-data="columnConfig"></div>

<!-- Conditional rendering -->
<div ng-if="showSection">
    <!-- Use ng-if for sections that toggle rarely (removes from DOM) -->
</div>

<div ng-show="isVisible">
    <!-- Use ng-show for frequent toggling (CSS display:none) -->
</div>

<!-- Lists -->
<div ng-repeat="item in items track by item.id">
    <span>{{item.name}}</span>
</div>
<!-- ALWAYS use track by — prevents unnecessary DOM recreation -->
```

## Internationalization

```xml
<!-- Message key from properties -->
<h2>#{msgs.ui_feature_page_title}</h2>

<!-- Angular spTranslate for dynamic text -->
<span>{{spTranslate('ui_feature_status_label')}}</span>

<!-- In attributes -->
<input placeholder="{{spTranslate('ui_feature_search_placeholder')}}" />

<!-- NEVER hardcode user-facing text -->
<!-- BAD -->
<h2>Certification Schedule</h2>
<!-- GOOD -->
<h2>#{msgs.ui_cert_schedule_title}</h2>
```

## Form Patterns

```xml
<div class="form-group" ng-class="{'has-error': form.fieldName.$invalid && form.fieldName.$touched}">
    <label for="fieldName">#{msgs.ui_feature_field_label}</label>
    <input type="text"
           id="fieldName"
           name="fieldName"
           ng-model="model.fieldName"
           ng-required="true"
           class="form-control"
           aria-describedby="fieldNameHelp" />
    <span id="fieldNameHelp" class="help-block"
          ng-show="form.fieldName.$invalid && form.fieldName.$touched">
        {{spTranslate('ui_feature_field_error')}}
    </span>
</div>
```

**Key rules:**
- `id` and `name` on every input — needed for label association and form validation
- `ng-class` for error states, not inline style manipulation
- `aria-describedby` linking input to its error/help text
- Error messages only shown when field is `$touched` (user has interacted)

## Include Patterns

```xml
<!-- Include a shared fragment -->
<ui:include src="/ui/include/sharedHeader.xhtml">
    <ui:param name="title" value="#{msgs.ui_feature_title}" />
</ui:include>

<!-- Conditional include -->
<ui:fragment rendered="#{showAdvancedOptions}">
    <ui:include src="/ui/include/advancedOptions.xhtml" />
</ui:fragment>
```

## Escaping & Security

- Use `#{msgs.key}` for server-rendered text (auto-escaped by JSF)
- Use `{{expression}}` for Angular-bound text (auto-escaped by Angular)
- Never use `ng-bind-html` without `$sce.trustAsHtml()` — and avoid both when possible
- Never construct HTML strings in JavaScript and inject via `innerHTML`

---
name: iiq-extjs-standards
description: ExtJS coding standards for IIQ grid/panel/store components. Loaded by Surgeon when task Layer = Frontend/ExtJS or task touches ExtJS components.
---

# IIQ ExtJS Coding Standards

## Class Definition

```javascript
Ext.define('SailPoint.grid.MetadataGrid', {
    extend: 'SailPoint.grid.AbstractGrid',

    requires: [
        'SailPoint.store.MetadataStore',
        'SailPoint.model.MetadataModel'
    ],

    // Configuration
    cls: 'metadata-grid',
    emptyText: '#{msgs.ui_metadata_no_results}',
    sortableColumns: true,

    // Columns
    columns: [
        {
            header: '#{msgs.ui_metadata_name}',
            dataIndex: 'name',
            flex: 1,
            sortable: true
        },
        {
            header: '#{msgs.ui_metadata_status}',
            dataIndex: 'status',
            width: 120,
            renderer: function(value) {
                return SailPoint.Utils.formatStatus(value);
            }
        }
    ],

    // Init
    initComponent: function() {
        this.store = Ext.create('SailPoint.store.MetadataStore');
        this.callParent(arguments);
    },

    // Cleanup
    onDestroy: function() {
        if (this.store) {
            this.store.destroyStore();
        }
        this.callParent(arguments);
    }
});
```

## Store Pattern

```javascript
Ext.define('SailPoint.store.MetadataStore', {
    extend: 'SailPoint.data.RestJsonStore',

    model: 'SailPoint.model.MetadataModel',

    restUrl: SailPoint.CONTEXT_PATH + '/rest/ui/metadataDefinitions',

    // Default params
    extraParams: {
        limit: 12,
        start: 0
    },

    sorters: [{
        property: 'name',
        direction: 'ASC'
    }]
});
```

## Model Pattern

```javascript
Ext.define('SailPoint.model.MetadataModel', {
    extend: 'Ext.data.Model',
    fields: [
        { name: 'id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'created', type: 'date', dateFormat: 'c' }
    ]
});
```

## ExtJS ↔ AngularJS Bridge

IIQ wraps ExtJS components inside AngularJS directives. Follow this pattern:

```javascript
// Directive that wraps an ExtJS grid
function spMetadataGrid() {
    return {
        restrict: 'E',
        scope: {
            config: '=spConfig'
        },
        link: function(scope, element, attrs) {
            // Create ExtJS component, render into directive element
            var grid = Ext.create('SailPoint.grid.MetadataGrid', {
                renderTo: element[0],
                config: scope.config
            });

            // Sync Angular scope ↔ ExtJS events
            grid.on('selectionchange', function(selModel, records) {
                scope.$apply(function() {
                    scope.config.selectedItems = records;
                });
            });

            // Cleanup: destroy ExtJS component when Angular scope dies
            scope.$on('$destroy', function() {
                if (grid && !grid.isDestroyed) {
                    grid.destroy();
                }
            });
        }
    };
}
```

**Key rules:**
- Always `$apply` when updating Angular scope from ExtJS events
- Always destroy ExtJS components in `$destroy` to prevent memory leaks
- Never access `$scope` directly from ExtJS code — go through the bridge directive

## Renderer Functions

```javascript
// Simple value formatting
renderer: function(value) {
    if (!value) return '';
    return Ext.String.htmlEncode(value);
}

// Complex rendering with metaData
renderer: function(value, metaData, record) {
    metaData.tdCls = (record.get('status') === 'Active') ? 'status-active' : 'status-inactive';
    return Ext.String.htmlEncode(value);
}

// ALWAYS htmlEncode user-supplied values to prevent XSS
```

## Event Handling

```javascript
// Listener in config
listeners: {
    selectionchange: function(selModel, records) {
        this.fireEvent('itemselected', records[0]);
    },
    scope: this
}

// Programmatic listener — always track for cleanup
this.mon(this.store, 'load', this.onStoreLoad, this);
// mon() auto-cleans on component destroy — prefer over on()
```

## Memory Management

- Use `this.mon()` instead of `component.on()` — auto-cleans on destroy
- Always implement `onDestroy` to clean up stores, DOM references, timers
- Destroy child components explicitly if created programmatically
- Never hold references to destroyed components

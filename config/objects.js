const { SALES_ORGS_SLUG, PARENT_IDS_SLUG } = require('./constants.js');

// TODO create a $ROOT/config/dataomething config file

const SALES_ORG_OBJECT = {
    objectName: 'cgcloud__Sales_Organization__c',
    externalId: 'cgcloud__Sales_Org_Value__c',
    fields: 'cgcloud__Sales_Org_Value__c',
    where: 'cgcloud__Sales_Org_Value__c IN (SALES_ORGS)',
    orderBy: 'cgcloud__Sales_Org_Value__c'
};

const OBJECTS = [
    SALES_ORG_OBJECT,
    // KPI objects - only exported if referenced by templates
    {
        objectName: 'cgcloud__KPI_Set__c',
        externalId: 'Name',
        fields: 'readonly_false',
        orderBy: 'Name',
        deleteOldData: false,
        slim: true
    },
    {
        objectName: 'cgcloud__KPI_Definition__c',
        externalId: 'Name',
        fields: 'readonly_false, RecordTypeId',
        orderBy: 'Name',
        deleteOldData: false,
        // Settings for self lookups
        hierarchy: {
            childField: 'Name',
            parentField: 'cgcloud__Distribution_Plan_Hierarchy_Dist_Metric__r.Name',
            parentIdField: 'cgcloud__Distribution_Plan_Hierarchy_Dist_Metric__c'
        },
        slim: true
    },
    {
        objectName: 'cgcloud__KPI_Set_KPI_Definition__c',
        externalId: 'cgcloud__KPI_Set__r.Name;cgcloud__KPI_Definition__r.Name',
        fields: 'readonly_false',
        orderBy: 'cgcloud__KPI_Set__r.Name, cgcloud__KPI_Definition__r.Name',
        deleteOldData: false,
        // Junction object settings
        junction: {
            // Parent IDs will be fetched based in parent object (cgcloud__KPI_Set__c.Name)
            where: `cgcloud__KPI_Set__r.Name IN (${PARENT_IDS_SLUG}) AND cgcloud__KPI_Definition__r.Name != NULL`,
            parent: {
                objectName: 'cgcloud__KPI_Set__c',
                externalId: 'Name'
            },
            // Objects include in the export, otherwise SFDMU will only query external IDs
            objects: ['cgcloud__KPI_Set__c', 'cgcloud__KPI_Definition__c', 'cgcloud__Condition_Search_Group__c']
        },
        slim: true
    },
    {
        objectName: 'cgcloud__Condition_Search_Group__c',
        externalId: 'Name',
        fields: 'readonly_false',
        orderBy: 'Name',
        deleteOldData: false
    },
    // Templates, depending on sales orgs
    {
        objectName: 'cgcloud__KPI_Map__c',
        externalId: 'Name',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Account_Template__c',
        externalId: 'Name',
        fields: 'readonly_false, RecordTypeId',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Fund_Template__c',
        externalId: 'cgcloud__Description_Language_1__c',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, cgcloud__Description_Language_1__c',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Tactic_Template_Fund_Template__c',
        externalId: 'cgcloud__Tactic_Template__r.Name;cgcloud__Fund_Template__r.cgcloud__Description_Language_1__c',
        fields: 'readonly_false',
        orderBy: 'cgcloud__Tactic_Template__r.Name, cgcloud__Fund_Template__r.cgcloud__Description_Language_1__c',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Fund_Transaction_Template__c',
        externalId: 'cgcloud__Description_Language_1__c',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, cgcloud__Description_Language_1__c',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Product_Template__c',
        externalId: 'cgcloud__External_Id__c;Name',
        fields: 'readonly_false, RecordTypeId',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, Name',
        deleteOldData: false,
        temporaryValues: {
            cgcloud__Is_Pushable__c: 'false' // Force pushable to false on first import
        }
    },
    {
        objectName: 'cgcloud__Product_Assortment_Template__c',
        externalId: 'cgcloud__Description_Language_1__c',
        fields: 'readonly_false, RecordTypeId',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, cgcloud__Description_Language_1__c',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Promotion_Template__c',
        externalId: 'cgcloud__Description_Language_1__c',
        fields: 'readonly_false, RecordTypeId',
        excluded: ['Hkey__c'],
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, cgcloud__Description_Language_1__c',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Tactic_Template__c',
        externalId: 'Name',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Org__c IN (${SALES_ORGS_SLUG})`,
        orderBy: 'cgcloud__Sales_Org__c, Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Tactic_Template_Cond_Creation_Def__c',
        externalId: 'cgcloud__Tactic_Template__r.Name;cgcloud__Source_Kpi_Definition__r.Name',
        fields: 'readonly_false',
        orderBy: 'cgcloud__Tactic_Template__r.Name, cgcloud__Source_Kpi_Definition__r.Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Promotion_Template_Tactic_Template__c',
        externalId: 'cgcloud__Promotion_Template__r.cgcloud__Description_Language_1__c;cgcloud__Tactic_Template__r.Name',
        fields: 'readonly_false',
        orderBy: 'cgcloud__Promotion_Template__r.cgcloud__Description_Language_1__c, cgcloud__Tactic_Template__r.Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Promotion_Template_Hierarchy__c',
        externalId: 'cgcloud__Parent_Promotion_Template__r.cgcloud__Description_Language_1__c;cgcloud__Child_Promotion_Template__r.cgcloud__Description_Language_1__c',
        fields: 'readonly_false',
        orderBy: 'cgcloud__Parent_Promotion_Template__r.cgcloud__Description_Language_1__c, cgcloud__Child_Promotion_Template__r.cgcloud__Description_Language_1__c',
        deleteOldData: false,
        junction: {
            where: `cgcloud__Parent_Promotion_Template__r.cgcloud__Description_Language_1__c IN (${PARENT_IDS_SLUG}) AND cgcloud__Child_Promotion_Template__r.cgcloud__Description_Language_1__c != NULL`,
            parent: {
                objectName: 'cgcloud__Promotion_Template__c',
                externalId: 'cgcloud__Description_Language_1__c'
            },
            objects: ['cgcloud__Promotion_Template__c']
        }
    },
    {
        objectName: 'cgcloud__RBF_Template__c',
        externalId: 'Name',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Org__c IN (SELECT Id FROM cgcloud__Sales_Organization__c WHERE cgcloud__Sales_Org_Value__c IN (${SALES_ORGS_SLUG}))`,
        orderBy: 'cgcloud__Sales_Org__c, Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__Payment_Template__c',
        externalId: 'Name',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Org__c IN (SELECT Id FROM cgcloud__Sales_Organization__c WHERE cgcloud__Sales_Org_Value__c IN (${SALES_ORGS_SLUG}))`,
        orderBy: 'cgcloud__Sales_Org__c, Name',
        deleteOldData: false
    },
    {
        objectName: 'cgcloud__RTR_Report_Configuration__c',
        externalId: 'cgcloud__Internal_Name__c',
        fields: 'readonly_false',
        where: `cgcloud__Sales_Organization__c IN (SELECT Id FROM cgcloud__Sales_Organization__c WHERE cgcloud__Sales_Org_Value__c IN (${SALES_ORGS_SLUG}))`,
        orderBy: 'cgcloud__Sales_Organization__c, cgcloud__Internal_Name__c',
        deleteOldData: false
    }
];

module.exports = {
    OBJECTS,
    SALES_ORG_OBJECT
};

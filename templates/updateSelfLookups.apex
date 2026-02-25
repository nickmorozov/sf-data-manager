List<String> allExternalIds = new List<String>{{{ALL_EXTERNAL_IDS}}};
Map<String, String> childToParentMap = new Map<String, String>{{{CHILD_PARENT_MAP}}};

// Get all KPI Definitions by name (both parents and children)
Map<String, Id> nameToIdMap = new Map<String, Id>();
for ({{OBJECT_NAME}} record : [
    SELECT {{CHILD_NAME}} FROM {{OBJECT_NAME}} WHERE {{CHILD_NAME}} IN :allExternalIds
]) {
    nameToIdMap.put(record.{{CHILD_NAME}}, record.Id);
}

// Update children to point to correct parent IDs
List<{{OBJECT_NAME}}> childrenToUpdate = new List<{{OBJECT_NAME}}>();
for (String childName : childToParentMap.keySet()) {
    String parentName = childToParentMap.get(childName);
    Id childId = nameToIdMap.get(childName);
    Id parentId = nameToIdMap.get(parentName);

    if (childId != null && parentId != null) {
        childrenToUpdate.add(new {{OBJECT_NAME}}(
            Id = childId,
            {{PARENT_NAME}} = parentId
        ));
    }
}

try {
    if (!childrenToUpdate.isEmpty()) {
        update childrenToUpdate;
    }
} catch (DmlException e) {
    System.debug('Error updating {{OBJECT_NAME}}: ' + e.getMessage());
}

System.debug('Updated ' + childrenToUpdate.size() + ' {{OBJECT_NAME}} with parent relationships.');

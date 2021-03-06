import { get, remove } from 'lodash';
import { safeDump } from 'js-yaml';
import {
  VM_KIND,
  CLOUDINIT_DISK,
  CLOUDINIT_VOLUME,
  VIRTIO_BUS,
  ANNOTATION_DEFAULT_DISK,
  ANNOTATION_DEFAULT_NETWORK,
  PARAM_VM_NAME,
  CUSTOM_FLAVOR,
  PROVISION_SOURCE_REGISTRY,
  PROVISION_SOURCE_URL
} from '../constants';
import { VirtualMachineModel, ProcessedTemplatesModel } from '../models';

export const createVM = (k8sCreate, basicSettings, network, storage) => {
  setParameterValue(basicSettings.chosenTemplate, PARAM_VM_NAME, basicSettings.name.value);

  // no more required parameters
  basicSettings.chosenTemplate.parameters.forEach(param => {
    if (param.name !== PARAM_VM_NAME && param.required) {
      delete param.required;
    }
  });

  // processedtemplate endpoint is namespaced
  basicSettings.chosenTemplate.metadata.namespace = basicSettings.namespace.value;

  return k8sCreate(ProcessedTemplatesModel, basicSettings.chosenTemplate).then(response => {
    const vm = response.objects.find(obj => obj.kind === VM_KIND);
    modifyVmObject(vm, basicSettings, network, storage);
    return k8sCreate(VirtualMachineModel, vm);
  });
};

const setFlavor = (vm, basicSettings) => {
  if (basicSettings.flavor.value === CUSTOM_FLAVOR) {
    vm.spec.template.spec.domain.cpu.cores = parseInt(basicSettings.cpu.value, 10);
    vm.spec.template.spec.domain.resources.requests.memory = `${basicSettings.memory.value}G`;
  }
};

const setParameterValue = (template, paramName, paramValue) => {
  const parameter = template.parameters.find(param => param.name === paramName);
  parameter.value = paramValue;
};

const modifyVmObject = (vm, basicSettings, network, storage) => {
  setFlavor(vm, basicSettings);
  setSourceType(vm, basicSettings);

  // add running status
  vm.spec.running = basicSettings.startVM ? basicSettings.startVM.value : false;

  // add namespace
  if (basicSettings.namespace) {
    vm.metadata.namespace = basicSettings.namespace.value;
  }

  // add description
  if (basicSettings.description) {
    addAnnotation(vm, 'description', basicSettings.description.value);
  }

  addCloudInit(vm, basicSettings);
};

const setSourceType = (vm, basicSettings) => {
  const defaultDiskName = get(basicSettings.chosenTemplate.metadata.annotations, [ANNOTATION_DEFAULT_DISK]);
  const defaultNetworkName = get(basicSettings.chosenTemplate.metadata.annotations, [ANNOTATION_DEFAULT_NETWORK]);

  const defaultDisk = getDefaultDevice(vm, 'disks', defaultDiskName);
  let defaultNetwork = getDefaultDevice(vm, 'interfaces', defaultNetworkName);

  remove(vm.spec.template.spec.volumes, volume => volume.name === defaultDisk.volumeName);

  switch (get(basicSettings.imageSourceType, 'value')) {
    case PROVISION_SOURCE_REGISTRY: {
      const volume = {
        name: defaultDisk.volumeName,
        registryDisk: {
          image: basicSettings.registryImage.value
        }
      };
      addVolume(vm, volume);
      break;
    }
    case PROVISION_SOURCE_URL: {
      const dataVolumeName = `datavolume-${basicSettings.name.value}`;
      const volume = {
        name: defaultDisk.volumeName,
        dataVolume: {
          name: dataVolumeName
        }
      };
      const dataVolume = {
        metadata: {
          name: dataVolumeName
        },
        spec: {
          pvc: {
            accessModes: ['ReadWriteOnce'],
            resources: {
              requests: {
                storage: '2Gi'
              }
            }
          },
          source: {
            http: {
              url: basicSettings.imageURL.value
            }
          }
        }
      };
      addDataVolume(vm, dataVolume);
      addVolume(vm, volume);
      break;
    }
    // PXE
    default: {
      if (!defaultNetwork) {
        defaultNetwork = {
          type: 'pod-network',
          name: 'default-network',
          model: 'virtio'
        };
        addInterface(vm, defaultNetwork);
      }
      defaultNetwork.bootOrder = 1;
      addAnnotation(vm, 'firstRun', 'true');
      break;
    }
  }
};

const getDefaultDevice = (vm, deviceType, deviceName) =>
  get(vm.spec.template.spec.domain.devices, deviceType, []).find(device => device.name === deviceName);

const addCloudInit = (vm, basicSettings) => {
  // remove existing config
  const volumes = get(vm.spec.template.spec, 'volumes', []);
  remove(volumes, volume => volume.hasOwnProperty('cloudInitNoCloud'));

  if (get(basicSettings.cloudInit, 'value', false)) {
    const cloudInitDisk = {
      name: CLOUDINIT_DISK,
      volumeName: CLOUDINIT_VOLUME,
      disk: {
        bus: VIRTIO_BUS
      }
    };
    addDisk(vm, cloudInitDisk);

    const userDataObject = {
      users: [
        {
          name: 'root',
          'ssh-authorized-keys': basicSettings.authKeys.value
        }
      ],
      hostname: basicSettings.hostname.value
    };

    const userData = safeDump(userDataObject);

    const userDataWithMagicHeader = `#cloud-config\n${userData}`;

    const cloudInitVolume = {
      name: CLOUDINIT_VOLUME,
      cloudInitNoCloud: {
        userData: userDataWithMagicHeader
      }
    };

    addVolume(vm, cloudInitVolume);
  }
};

const addDisk = (vm, diskSpec) => {
  const domain = get(vm.spec.template.spec, 'domain', {});
  const devices = get(domain, 'devices', {});
  const disks = get(devices, 'disks', []);
  disks.push(diskSpec);
  devices.disks = disks;
  domain.devices = devices;
  vm.spec.template.spec.domain = domain;
};

const addVolume = (vm, volumeSpec) => {
  const volumes = get(vm.spec.template.spec, 'volumes', []);
  volumes.push(volumeSpec);
  vm.spec.template.spec.volumes = volumes;
};

const addDataVolume = (vm, dataVolumeSpec) => {
  const dataVolumes = get(vm.spec, 'dataVolumeTemplates', []);
  dataVolumes.push(dataVolumeSpec);
  vm.spec.dataVolumeTemplates = dataVolumes;
};

const addInterface = (vm, interfaceSpec) => {
  const domain = get(vm.spec.template.spec, 'domain', {});
  const devices = get(domain, 'devices', {});
  const interfaces = get(devices, 'interfaces', []);
  interfaces.push(interfaceSpec);
  devices.interfaces = interfaces;
  domain.devices = devices;
  vm.spec.template.spec.domain = domain;
};

const addAnnotation = (vm, key, value) => {
  const annotations = get(vm.metadata, 'annotations', {});
  annotations[key] = value;
  vm.metadata.annotations = annotations;
};

"""Unified segmentation model interface.

本模块把具体分割模型封装成统一接口。上层 API 只调用 predict，不需要关心
PointNet 的模型路径、权重加载、分块推理和投票融合细节。
"""
import abc
import os
import sys

import numpy as np
import torch

from ..config import BATCH_SIZE, BLOCK_SIZE, MODEL_CHECKPOINT, NUM_CLASSES, NUM_POINT, POINTNET_DIR
from .pointcloud_loader import preprocess_for_inference


class BaseSegModel(abc.ABC):
    """Abstract interface for semantic segmentation models."""

    @abc.abstractmethod
    def load(self, checkpoint_path: str):
        ...

    @abc.abstractmethod
    def predict(self, points: np.ndarray) -> np.ndarray:
        """
        Input: (N, >=6) point cloud (xyz + rgb [+ label])
        Output: (N,) predicted class id for each point
        """


class PointNetSegModel(BaseSegModel):
    """PointNet semantic segmentation model wrapper.

    负责加载外部 PointNet 模型，并把完整点云预测为逐点类别标签。
    """

    def __init__(self):
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def load(self, checkpoint_path: str = MODEL_CHECKPOINT):
        """加载 PointNet 网络结构和训练好的权重文件。"""
        models_dir = os.path.join(POINTNET_DIR, "models")
        if not os.path.isdir(models_dir):
            raise FileNotFoundError(
                f"PointNet models directory not found: {models_dir}. "
                "Set WATER_TWIN_POINTNET_DIR or update backend/app/config.py."
            )
        if not os.path.isfile(checkpoint_path):
            raise FileNotFoundError(
                f"Model checkpoint not found: {checkpoint_path}. "
                "Set WATER_TWIN_MODEL_CHECKPOINT or update backend/app/config.py."
            )

        if models_dir not in sys.path:
            sys.path.insert(0, models_dir)

        from pointnet_sem_seg import get_model  # type: ignore

        self.model = get_model(NUM_CLASSES).to(self.device)
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()
        return self

    def predict(self, points: np.ndarray) -> np.ndarray:
        """对完整点云执行分块推理，并用投票池融合成最终逐点标签。"""
        if self.model is None:
            raise RuntimeError("Model is not loaded. Call load() first.")

        num_points = points.shape[0]
        stride = BLOCK_SIZE / 2
        batched_data, point_indices = preprocess_for_inference(
            points,
            block_size=BLOCK_SIZE,
            num_point=NUM_POINT,
            stride=stride,
        )

        # vote_pool 的每一行对应一个原始点，每一列对应一个语义类别。
        # 同一个点可能在重叠分块中被预测多次，最终取票数最高的类别。
        vote_pool = np.zeros((num_points, NUM_CLASSES), dtype=np.float32)
        total_blocks = batched_data.shape[0]

        with torch.no_grad():
            for start in range(0, total_blocks, BATCH_SIZE):
                end = min(start + BATCH_SIZE, total_blocks)
                batch = torch.from_numpy(batched_data[start:end]).float().to(self.device)
                batch = batch.transpose(2, 1)  # (B, 9, N)
                seg_pred, _ = self.model(batch)
                pred_labels = seg_pred.cpu().numpy().argmax(axis=2)  # (B, N)

                idx_batch = point_indices[start:end]
                for b in range(pred_labels.shape[0]):
                    for n in range(pred_labels.shape[1]):
                        vote_pool[int(idx_batch[b, n]), int(pred_labels[b, n])] += 1

        return vote_pool.argmax(axis=1)


_model_instance: BaseSegModel | None = None


def get_model_instance() -> BaseSegModel:
    """按需创建全局模型实例，避免每次推理都重复加载权重。"""
    global _model_instance
    if _model_instance is None:
        _model_instance = PointNetSegModel()
        _model_instance.load()
    return _model_instance
